import { decompressDebArchiveMember, findDebArchiveMember } from "./deb-archive";
import { DebControlParseError, foldStanzaValue, parseStanza } from "./stanza";
import { readTarEntries } from "./tar";

export type DebControlMetadata = Record<string, string>;

export { DebControlParseError };

/**
 * Fields whose line structure carries meaning and so survives parsing intact.
 * `Description` is the short summary followed by the extended description, in
 * which a line of "." marks a paragraph break. Every other field wraps purely
 * for readability, so those are folded back onto one line.
 */
const verbatimControlFields = new Set(["description"]);

const textDecoder = new TextDecoder();

export async function readDebControlMetadata(bytes: Uint8Array): Promise<DebControlMetadata> {
  return parseDebianControl(await readControlFile(bytes));
}

async function readControlFile(bytes: Uint8Array): Promise<string> {
  const archive = findDebArchiveMember(bytes, "control.tar");
  for await (const entry of readTarEntries(decompressDebArchiveMember(archive))) {
    if (entry.header.name === "control" || entry.header.name === "./control") {
      return textDecoder.decode(entry.bytes);
    }
  }
  throw new DebControlParseError("APT artifact control archive does not contain a control file");
}

export function parseDebianControl(text: string): DebControlMetadata {
  const metadata: DebControlMetadata = {};

  for (const field of parseStanza(text)) {
    const name = field.name.toLowerCase();
    metadata[name] = verbatimControlFields.has(name) ? field.value : foldStanzaValue(field.value);
  }

  return metadata;
}
