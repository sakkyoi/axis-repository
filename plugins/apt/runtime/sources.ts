import { ValidationError } from "@axis-repository/core";
import { md5Hex } from "../shared/md5";
import { formatStanza, parseStanza, stanzaField, type DebianStanza } from "../shared/stanza";
import { digestHex } from "@axis-repository/runtime-cloudflare/plugin-runtime";

/** One file that makes up a source package, as a `.dsc` lists it. */
export interface DscFileReference {
  name: string;
  size: number;
  md5?: string;
  sha1?: string;
  sha256?: string;
}

export interface ParsedDsc {
  stanza: DebianStanza;
  sourceName: string;
  version: string;
  files: DscFileReference[];
}

const checksumFields = [
  { field: "Files", digest: "md5" },
  { field: "Checksums-Sha1", digest: "sha1" },
  { field: "Checksums-Sha256", digest: "sha256" },
] as const;

const textDecoder = new TextDecoder();

/**
 * Reads a `.dsc`, which may be OpenPGP clearsigned.
 *
 * The signature is not verified here. A `.dsc` names the tarballs of its
 * source package along with their sizes and digests, and those are what the
 * published `Sources` index has to agree with; the upload pipeline has already
 * verified the bytes it stored against the digests the publisher declared.
 */
export function parseDsc(bytes: Uint8Array): ParsedDsc {
  const stanza = parseStanza(stripClearsign(textDecoder.decode(bytes)));
  const sourceName = requiredDscField(stanza, "Source");
  const version = requiredDscField(stanza, "Version");

  return { stanza, sourceName, version, files: parseDscFiles(stanza) };
}

/** Strips the clearsign armour so the control stanza inside can be parsed. */
export function stripClearsign(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("-----BEGIN PGP SIGNED MESSAGE-----")) {
    return normalized;
  }

  const bodyStart = normalized.indexOf("\n\n");
  const signatureStart = normalized.indexOf("\n-----BEGIN PGP SIGNATURE-----");
  if (bodyStart === -1 || signatureStart === -1 || signatureStart < bodyStart) {
    throw new ValidationError("APT source .dsc signature block is malformed");
  }

  // A clearsigned body escapes a leading "-" as "- -".
  return normalized.slice(bodyStart + 2, signatureStart).replace(/^- /gm, "");
}

function parseDscFiles(stanza: DebianStanza): DscFileReference[] {
  const byName = new Map<string, DscFileReference>();

  for (const { field, digest } of checksumFields) {
    const value = stanzaField(stanza, field);
    if (value === undefined) {
      continue;
    }
    for (const line of value.split("\n")) {
      const parts = line.trim().split(/\s+/);
      const [checksum, size, name] = parts;
      if (parts.length !== 3 || !checksum || !size || !name) {
        continue;
      }
      const entry = byName.get(name) ?? { name, size: Number.parseInt(size, 10) };
      entry[digest] = checksum;
      byName.set(name, entry);
    }
  }

  return [...byName.values()];
}

export interface SourceComponentFile {
  name: string;
  size: number;
  sha256: string;
  bytes?: Uint8Array | undefined;
}

/**
 * Builds the `Sources` stanza a source package publishes.
 *
 * `Directory:` replaces the per-file paths a `.dsc` does not carry, and the
 * `.dsc` itself is added to every checksum list: it describes the other files
 * but never itself, and apt needs to fetch and check it like any other.
 */
export async function buildSourceStanza(input: {
  dsc: ParsedDsc;
  dscFile: { name: string; size: number; bytes: Uint8Array };
  component: string;
  directory: string;
}): Promise<DebianStanza> {
  const dscEntry: DscFileReference = {
    name: input.dscFile.name,
    size: input.dscFile.size,
    md5: md5Hex(input.dscFile.bytes),
    sha1: await digestHex("SHA-1", input.dscFile.bytes),
    sha256: await digestHex("SHA-256", input.dscFile.bytes),
  };
  const files = [dscEntry, ...input.dsc.files.filter((file) => file.name !== dscEntry.name)];
  const stanza: DebianStanza = [];

  for (const field of input.dsc.stanza) {
    const name = field.name.toLowerCase();
    if (checksumFields.some((candidate) => candidate.field.toLowerCase() === name)) {
      continue;
    }
    // Sources names the source package in Package:, where a .dsc says Source:.
    stanza.push(name === "source" ? { name: "Package", value: field.value } : field);
  }

  stanza.push({ name: "Directory", value: input.directory });
  for (const { field, digest } of checksumFields) {
    // A checksum section has to cover every file or none: a `.dsc` that omits
    // Checksums-Sha1 would otherwise publish a list naming only the `.dsc`,
    // which reads as "these are all the files" to anything that trusts it.
    if (!files.every((file) => file[digest] !== undefined)) {
      continue;
    }
    // Every entry belongs on its own indented line, starting below the name.
    const lines = files.map((file) => ` ${file[digest] ?? ""} ${file.size} ${file.name}`);
    stanza.push({ name: field, value: `\n${lines.join("\n")}` });
  }

  return stanza;
}

/** Identifies a source package within one `Sources` index. */
export function sourceStanzaIdentity(stanza: DebianStanza): string {
  return `${stanzaField(stanza, "Package") ?? ""}\0${stanzaField(stanza, "Version") ?? ""}`;
}

export function formatSourcesIndex(stanzas: DebianStanza[]): string | undefined {
  if (stanzas.length === 0) {
    return undefined;
  }
  return [...stanzas]
    .sort((left, right) => sourceStanzaIdentity(left).localeCompare(sourceStanzaIdentity(right)))
    .map((stanza) => formatStanza(stanza))
    .join("\n");
}

/** Merges freshly published source stanzas over what the index already holds. */
export function mergeSourceStanzas(existing: DebianStanza[], incoming: DebianStanza[]): DebianStanza[] {
  const merged = [...existing];

  for (const stanza of incoming) {
    const identity = sourceStanzaIdentity(stanza);
    const replaced = merged.findIndex((candidate) => sourceStanzaIdentity(candidate) === identity);
    if (replaced === -1) {
      merged.push(stanza);
    } else {
      merged[replaced] = stanza;
    }
  }

  return merged;
}

/** The pool paths a source stanza points at, relative to the repository root. */
export function sourceStanzaFilenames(stanza: DebianStanza): string[] {
  const directory = stanzaField(stanza, "Directory");
  const files = stanzaField(stanza, "Checksums-Sha256") ?? stanzaField(stanza, "Files");
  if (directory === undefined || files === undefined) {
    return [];
  }

  return files
    .split("\n")
    .map((line) => line.trim().split(/\s+/)[2])
    .filter((name): name is string => name !== undefined && name !== "")
    .map((name) => `${directory}/${name}`);
}

function requiredDscField(stanza: DebianStanza, field: string): string {
  const value = stanzaField(stanza, field);
  if (value === undefined || value === "") {
    throw new ValidationError(`APT source .dsc is missing ${field}`);
  }
  return value;
}
