import { ArchiveParseError, streamFromBytes, type ByteStream } from "./tar";

/**
 * Reading one file out of a zip without downloading the zip.
 *
 * A zip is indexed from its end: a locator record sits at the tail, and points
 * back at a central directory listing every entry with the offset of its data.
 * So a wheel of several hundred megabytes gives up its METADATA for three
 * small reads, where a format read front-to-back would have to stream the lot.
 */

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_EOCD_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const CENTRAL_FILE_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;

const EOCD_SIZE = 22;
const ZIP64_EOCD_LOCATOR_SIZE = 20;
const LOCAL_HEADER_SIZE = 30;
/** A zip comment may be 64 KiB, and the locator sits in front of it. */
const TAIL_READ_SIZE = 64 * 1024 + EOCD_SIZE + ZIP64_EOCD_LOCATOR_SIZE;

const STORED = 0;
const DEFLATED = 8;

/** A zip that can be read in pieces, the same shape the deb reader uses. */
export interface ZipSource {
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export interface ZipEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  /** Offset of the entry's local header, not of its data. */
  localHeaderOffset: number;
}

/** Serves a zip already in memory, for callers that hold one. */
export function zipSourceFromBytes(bytes: Uint8Array): ZipSource {
  return {
    size: bytes.byteLength,
    read: async (offset, length) => bytes.subarray(offset, offset + length),
  };
}

/**
 * Reads the central directory, which names every entry in the archive.
 *
 * Only the directory is fetched, never the entries themselves.
 */
export async function readZipEntries(source: ZipSource): Promise<ZipEntry[]> {
  const directory = await locateCentralDirectory(source);
  if (directory.size === 0) {
    return [];
  }
  const bytes = await source.read(directory.offset, directory.size);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries: ZipEntry[] = [];
  let cursor = 0;

  while (cursor + 46 <= bytes.byteLength) {
    if (view.getUint32(cursor, true) !== CENTRAL_FILE_SIGNATURE) {
      break;
    }
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const nameStart = cursor + 46;
    const entry: ZipEntry = {
      name: new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLength)),
      compressionMethod: view.getUint16(cursor + 10, true),
      compressedSize: view.getUint32(cursor + 20, true),
      uncompressedSize: view.getUint32(cursor + 24, true),
      localHeaderOffset: view.getUint32(cursor + 42, true),
    };
    applyZip64Extra(entry, bytes.subarray(nameStart + nameLength, nameStart + nameLength + extraLength));
    entries.push(entry);
    cursor = nameStart + nameLength + extraLength + commentLength;
  }

  return entries;
}

/**
 * Reads one entry's contents.
 *
 * The central directory records where an entry's *header* is, not its data;
 * the header carries its own name and extra-field lengths, so the data offset
 * is only known once it has been read.
 */
export async function readZipEntry(source: ZipSource, entry: ZipEntry): Promise<Uint8Array> {
  const header = await source.read(entry.localHeaderOffset, LOCAL_HEADER_SIZE);
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (view.getUint32(0, true) !== LOCAL_FILE_SIGNATURE) {
    throw new ArchiveParseError(`zip entry header is invalid: ${entry.name}`);
  }

  const dataOffset = entry.localHeaderOffset
    + LOCAL_HEADER_SIZE
    + view.getUint16(26, true)
    + view.getUint16(28, true);
  const compressed = await source.read(dataOffset, entry.compressedSize);

  if (entry.compressionMethod === STORED) {
    return compressed;
  }
  if (entry.compressionMethod !== DEFLATED) {
    throw new ArchiveParseError(
      `zip entry compression is not supported: ${entry.name} (method ${entry.compressionMethod})`,
    );
  }
  return inflateRaw(compressed);
}

async function inflateRaw(compressed: Uint8Array): Promise<Uint8Array> {
  const stream = (streamFromBytes(compressed) as ByteStream)
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream as ReadableStream).arrayBuffer());
}

/**
 * Finds the central directory by scanning back from the end of the file.
 *
 * The end-of-directory record is last, except that a zip may carry a trailing
 * comment of up to 64 KiB, so it has to be searched for rather than read at a
 * fixed offset.
 */
async function locateCentralDirectory(source: ZipSource): Promise<{ offset: number; size: number }> {
  const tailLength = Math.min(source.size, TAIL_READ_SIZE);
  const tailStart = source.size - tailLength;
  const tail = await source.read(tailStart, tailLength);
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);

  for (let cursor = tail.byteLength - EOCD_SIZE; cursor >= 0; cursor -= 1) {
    if (view.getUint32(cursor, true) !== EOCD_SIGNATURE) {
      continue;
    }
    const size = view.getUint32(cursor + 12, true);
    const offset = view.getUint32(cursor + 16, true);
    if (size !== 0xffffffff && offset !== 0xffffffff) {
      return { offset, size };
    }
    // Either field saturated, so the real values are in the zip64 record the
    // locator in front of this one points at.
    return readZip64Directory(source, tail, view, tailStart, cursor);
  }

  throw new ArchiveParseError("zip end of central directory record was not found");
}

async function readZip64Directory(
  source: ZipSource,
  tail: Uint8Array,
  tailView: DataView,
  tailStart: number,
  eocdOffset: number,
): Promise<{ offset: number; size: number }> {
  const locatorOffset = eocdOffset - ZIP64_EOCD_LOCATOR_SIZE;
  if (locatorOffset < 0 || tailView.getUint32(locatorOffset, true) !== ZIP64_EOCD_LOCATOR_SIGNATURE) {
    throw new ArchiveParseError("zip64 end of central directory locator was not found");
  }

  const recordOffset = readUint64(tailView, locatorOffset + 8);
  const record = recordOffset >= tailStart
    ? tail.subarray(recordOffset - tailStart, recordOffset - tailStart + 56)
    : await source.read(recordOffset, 56);
  const view = new DataView(record.buffer, record.byteOffset, record.byteLength);
  if (view.getUint32(0, true) !== ZIP64_EOCD_SIGNATURE) {
    throw new ArchiveParseError("zip64 end of central directory record is invalid");
  }

  return { size: readUint64(view, 40), offset: readUint64(view, 48) };
}

/**
 * Applies the zip64 extra field, which holds the real values for whichever
 * of an entry's sizes and offsets did not fit in 32 bits.
 *
 * The fields present are exactly those that saturated, in a fixed order, so
 * which one a value belongs to depends on what came before it.
 */
function applyZip64Extra(entry: ZipEntry, extra: Uint8Array): void {
  const view = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
  let cursor = 0;

  while (cursor + 4 <= extra.byteLength) {
    const headerId = view.getUint16(cursor, true);
    const size = view.getUint16(cursor + 2, true);
    if (headerId !== 0x0001) {
      cursor += 4 + size;
      continue;
    }

    let field = cursor + 4;
    if (entry.uncompressedSize === 0xffffffff && field + 8 <= extra.byteLength) {
      entry.uncompressedSize = readUint64(view, field);
      field += 8;
    }
    if (entry.compressedSize === 0xffffffff && field + 8 <= extra.byteLength) {
      entry.compressedSize = readUint64(view, field);
      field += 8;
    }
    if (entry.localHeaderOffset === 0xffffffff && field + 8 <= extra.byteLength) {
      entry.localHeaderOffset = readUint64(view, field);
    }
    return;
  }
}

/**
 * Reads a 64-bit little-endian value as a number.
 *
 * Offsets past 2^53 would lose precision, but a zip that large cannot be
 * addressed by anything here anyway, so it is rejected rather than silently
 * read at the wrong place.
 */
function readUint64(view: DataView, offset: number): number {
  const value = view.getBigUint64(offset, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ArchiveParseError("zip is too large to address");
  }
  return Number(value);
}
