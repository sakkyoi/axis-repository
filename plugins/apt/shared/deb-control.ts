import {
  debArchiveSourceFromBytes,
  decompressDebArchiveMember,
  findDebArchiveMember,
  type DebArchiveSource,
} from "./deb-archive";
import { DebControlParseError, foldStanzaValue, parseStanza } from "./stanza";
import { readTarEntries } from "@axis-repository/core/archives";

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

export async function readDebControlMetadata(
  source: DebArchiveSource | Uint8Array,
): Promise<DebControlMetadata> {
  return parseDebianControl(await readControlFile(
    source instanceof Uint8Array ? debArchiveSourceFromBytes(source) : source,
  ));
}

async function readControlFile(source: DebArchiveSource): Promise<string> {
  const member = await findDebArchiveMember(source, "control.tar");
  for await (const entry of readTarEntries(decompressDebArchiveMember(source, member))) {
    if (entry.header.name === "control" || entry.header.name === "./control") {
      return textDecoder.decode(await entry.bytes());
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
