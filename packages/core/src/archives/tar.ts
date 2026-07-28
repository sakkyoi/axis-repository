/** Raised when an archive cannot be read as the format it claims to be. */
export class ArchiveParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchiveParseError";
  }
}

const textDecoder = new TextDecoder();
const TAR_BLOCK_SIZE = 512;

export interface TarEntryHeader {
  name: string;
  size: number;
  /** ustar type flag: "0"/"\0" regular, "5" directory, "L" long name, and so on. */
  typeFlag: string;
}

export interface TarEntry {
  header: TarEntryHeader;
  /**
   * Reads this entry's payload.
   *
   * A caller that never asks is never charged for it: the payload is skipped
   * over in the stream rather than allocated. Listing the paths in a data
   * archive therefore costs nothing per file, however large the files are.
   */
  bytes(): Promise<Uint8Array>;
}

/**
 * Walks a tar stream, yielding each entry's header and a reader for its payload.
 *
 * A `.deb` holds two tars: the control archive, of which one small file is
 * read, and the data archive, of which only the entry names are needed. Both
 * go through here so the header parsing and its bounds checks exist once.
 */
export async function* readTarEntries(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<TarEntry> {
  const reader = new TarByteReader(stream);
  let pendingLongName: string | undefined;

  while (true) {
    const headerBlock = await reader.read(TAR_BLOCK_SIZE);
    if (!headerBlock || headerBlock.every((byte) => byte === 0)) {
      return;
    }

    const header = parseTarHeader(headerBlock);

    // GNU tar stores a name longer than 100 bytes as its own preceding entry.
    if (header.typeFlag === "L") {
      pendingLongName = readNullTerminatedText(await readPayload(reader, header.size));
      await reader.skip(paddingFor(header.size));
      continue;
    }

    let payload: Uint8Array | undefined;
    yield {
      header: pendingLongName === undefined ? header : { ...header, name: pendingLongName },
      bytes: async () => (payload ??= await readPayload(reader, header.size)),
    };

    if (payload === undefined) {
      await reader.skip(header.size);
    }
    await reader.skip(paddingFor(header.size));
    pendingLongName = undefined;
  }
}

async function readPayload(reader: TarByteReader, size: number): Promise<Uint8Array> {
  const bytes = await reader.read(size);
  if (!bytes) {
    throw new ArchiveParseError("tar archive is truncated");
  }
  return bytes;
}

export function tarEntryIsFile(header: TarEntryHeader): boolean {
  return header.typeFlag === "0" || header.typeFlag === "\0" || header.typeFlag === "";
}

/** Strips the "./" that dpkg writes in front of every data archive path. */
export function normalizeTarPath(name: string): string {
  return name.replace(/^\.?\//, "").replace(/\/+$/, "");
}

/**
 * Wraps bytes as a stream via `Blob`.
 *
 * Constructing the stream directly types its chunks as `Uint8Array<ArrayBuffer>`,
 * which the DOM and workers-types declarations of `pipeThrough` disagree about;
 * going through `Blob` gives the one shape both accept.
 */
export function streamFromBytes(bytes: Uint8Array) {
  return new Blob([arrayBufferFromBytes(bytes)]).stream();
}

/** The byte-stream shape both of those declarations accept. */
export type ByteStream = ReturnType<typeof streamFromBytes>;

/** The chunk that shape carries, which the two declarations also disagree about. */
export type ByteChunk = ByteStream extends ReadableStream<infer Chunk> ? Chunk : never;

function arrayBufferFromBytes(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function parseTarHeader(block: Uint8Array): TarEntryHeader {
  const size = Number.parseInt(readNullTerminatedText(block.slice(124, 136)).trim() || "0", 8);
  if (!Number.isFinite(size) || size < 0) {
    throw new ArchiveParseError("tar header is invalid");
  }

  const prefix = readNullTerminatedText(block.slice(345, 500));
  const name = readNullTerminatedText(block.slice(0, 100));
  const typeFlagByte = block[156];

  return {
    name: prefix ? `${prefix}/${name}` : name,
    size,
    typeFlag: typeFlagByte === undefined ? "" : String.fromCharCode(typeFlagByte),
  };
}

function paddingFor(size: number): number {
  return (TAR_BLOCK_SIZE - (size % TAR_BLOCK_SIZE)) % TAR_BLOCK_SIZE;
}

function readNullTerminatedText(bytes: Uint8Array): string {
  const end = bytes.indexOf(0);
  return textDecoder.decode(end === -1 ? bytes : bytes.slice(0, end));
}

/**
 * Reads exact byte counts out of a stream.
 *
 * Only what a caller asks for is held: walking a data archive of several
 * gigabytes to list its paths never keeps more than one entry in memory.
 */
class TarByteReader {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private buffered: Uint8Array[] = [];
  private bufferedLength = 0;
  private done = false;

  constructor(stream: ReadableStream<Uint8Array>) {
    this.reader = stream.getReader();
  }

  async read(length: number): Promise<Uint8Array | undefined> {
    if (length === 0) {
      return new Uint8Array(0);
    }
    while (this.bufferedLength < length && !this.done) {
      await this.pull();
    }
    if (this.bufferedLength < length) {
      return undefined;
    }

    const output = new Uint8Array(length);
    let offset = 0;
    while (offset < length) {
      const chunk = this.buffered[0];
      if (!chunk) {
        break;
      }
      const take = Math.min(chunk.byteLength, length - offset);
      output.set(chunk.subarray(0, take), offset);
      offset += take;
      if (take === chunk.byteLength) {
        this.buffered.shift();
      } else {
        this.buffered[0] = chunk.subarray(take);
      }
      this.bufferedLength -= take;
    }
    return output;
  }

  /** Discards bytes without allocating them, however many are asked for. */
  async skip(length: number): Promise<void> {
    let remaining = length;
    while (remaining > 0) {
      if (this.bufferedLength === 0) {
        if (this.done) {
          return;
        }
        await this.pull();
        continue;
      }
      const chunk = this.buffered[0];
      if (!chunk) {
        this.bufferedLength = 0;
        continue;
      }
      const take = Math.min(chunk.byteLength, remaining);
      if (take === chunk.byteLength) {
        this.buffered.shift();
      } else {
        this.buffered[0] = chunk.subarray(take);
      }
      this.bufferedLength -= take;
      remaining -= take;
    }
  }

  private async pull(): Promise<void> {
    const next = await this.reader.read();
    if (next.done) {
      this.done = true;
      return;
    }
    this.buffered.push(next.value);
    this.bufferedLength += next.value.byteLength;
  }
}
