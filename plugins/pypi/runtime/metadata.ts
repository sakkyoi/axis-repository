import { ValidationError } from "@axis-repository/core";
import {
  readTarEntries,
  readZipEntries,
  readZipEntry,
  type ByteStream,
  type ZipSource,
} from "@axis-repository/core/archives";
import { normalizeProjectName, type PypiDistributionFilename } from "./names";

/**
 * What a distribution says about itself.
 *
 * A filename is a claim; this is the package's own record. They are checked
 * against each other because the filename decides which project page a file is
 * listed on, and a file that says it is something else has no business there.
 */
export interface PypiCoreMetadata {
  name: string;
  version: string;
  /** The `Requires-Python` marker, which pip uses to skip files it cannot use. */
  requiresPython?: string;
  /** The metadata document itself, as PEP 658 serves it alongside the file. */
  text: string;
}

const METADATA_PATH = /(^|\/)[^/]+\.dist-info\/METADATA$/;

/**
 * Reads a wheel's core metadata.
 *
 * A wheel is a zip, so only its directory and the one entry are fetched: the
 * payload, which is nearly all of it, is never read.
 */
export async function readWheelMetadata(source: ZipSource): Promise<PypiCoreMetadata> {
  const entries = await readZipEntries(source);
  const entry = entries.find((candidate) => METADATA_PATH.test(candidate.name));
  if (!entry) {
    throw new ValidationError("wheel does not contain a dist-info/METADATA file");
  }
  return parseCoreMetadata(new TextDecoder().decode(await readZipEntry(source, entry)));
}

/**
 * Reads a source distribution's core metadata.
 *
 * A `.tar.gz` cannot be seeked, so this walks from the front and stops at
 * `PKG-INFO`, which the tools that build sdists write near the beginning.
 */
export async function readSdistMetadata(stream: ByteStream): Promise<PypiCoreMetadata> {
  const entries = readTarEntries(
    stream.pipeThrough(new DecompressionStream("gzip")) as ReadableStream<Uint8Array>,
  );

  for await (const entry of entries) {
    // Exactly one level down, so a PKG-INFO inside a vendored package or a
    // test fixture cannot stand in for the distribution's own.
    const segments = entry.header.name.replace(/^\.\//, "").split("/");
    if (segments.length === 2 && segments[1] === "PKG-INFO") {
      return parseCoreMetadata(new TextDecoder().decode(await entry.bytes()));
    }
  }

  throw new ValidationError("source distribution does not contain a PKG-INFO file");
}

/**
 * Parses the RFC 822 headers core metadata is written as.
 *
 * Only the fields this repository needs are read. The body after the first
 * blank line is the long description, which is not one of them.
 */
export function parseCoreMetadata(text: string): PypiCoreMetadata {
  const fields = new Map<string, string>();

  for (const line of text.split(/\r?\n/)) {
    if (line === "") {
      break;
    }
    // Continuation lines belong to the previous field; none of the fields read
    // here are ever folded, so they are skipped rather than joined.
    if (/^[ \t]/.test(line)) {
      continue;
    }
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }
    const name = line.slice(0, separator).trim().toLowerCase();
    if (!fields.has(name)) {
      fields.set(name, line.slice(separator + 1).trim());
    }
  }

  const name = fields.get("name");
  const version = fields.get("version");
  if (!name || !version) {
    throw new ValidationError("distribution metadata does not name a project and version");
  }

  const requiresPython = fields.get("requires-python");
  return {
    name,
    version,
    ...(requiresPython ? { requiresPython } : {}),
    text,
  };
}

/**
 * Rejects a file whose contents disagree with the name it was uploaded under.
 *
 * The filename is what places a file on a project page, so a wheel called
 * `django-5.0-...whl` that contains something else would be offered to anyone
 * asking pip for Django.
 */
export function requireMetadataMatchesFilename(
  metadata: PypiCoreMetadata,
  filename: PypiDistributionFilename,
): void {
  if (normalizeProjectName(metadata.name) !== filename.normalizedName) {
    throw new ValidationError(
      `distribution filename says ${filename.normalizedName} but its metadata says ${normalizeProjectName(metadata.name)}`,
    );
  }
  if (normalizeVersion(metadata.version) !== normalizeVersion(filename.version)) {
    throw new ValidationError(
      `distribution filename says version ${filename.version} but its metadata says ${metadata.version}`,
    );
  }
}

/**
 * Compares versions the way a filename spells them.
 *
 * A wheel escapes `-` to `_` in the version, and `1.0.0` in a filename may be
 * written `1.0` in metadata only when they are literally equal — no attempt is
 * made to implement PEP 440 equivalence here, since a mismatch is reported
 * rather than resolved.
 */
function normalizeVersion(version: string): string {
  return version.replace(/_/g, "-").toLowerCase();
}
