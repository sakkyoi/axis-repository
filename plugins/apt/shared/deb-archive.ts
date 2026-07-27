import { Decompress as ZstdDecompress } from "fzstd";
import { XzReadableStream } from "xz-decompress";
import { DebControlParseError } from "./stanza";
import { streamFromBytes, type ByteChunk, type ByteStream } from "./tar";

const textDecoder = new TextDecoder();
const arGlobalHeader = "!<arch>\n";
const AR_HEADER_SIZE = 60;

/**
 * How much of a `.deb` is fetched up front to walk its member headers.
 *
 * The members are `debian-binary`, `control.tar.*` and `data.tar.*`, and the
 * first two together are a few kilobytes, so one read of this size normally
 * locates all three. Anything past it falls back to reading each 60-byte
 * header on its own.
 */
const HEAD_READ_SIZE = 64 * 1024;

/**
 * A `.deb` that can be read in pieces.
 *
 * An upload is allowed to be gigabytes and a worker has 128 MB of heap, so the
 * archive is addressed rather than held: member headers come from small reads,
 * and the data archive is walked as a stream.
 */
export interface DebArchiveSource {
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
  stream(offset: number, length: number): ByteStream;
}

export interface DebArchiveMember {
  name: string;
  offset: number;
  size: number;
}

/** Serves a `.deb` that is already in memory, for callers that hold one. */
export function debArchiveSourceFromBytes(bytes: Uint8Array): DebArchiveSource {
  return {
    size: bytes.byteLength,
    read: async (offset, length) => bytes.subarray(offset, offset + length),
    stream: (offset, length) => streamFromBytes(bytes.subarray(offset, offset + length)),
  };
}

/**
 * Locates the first `ar` member whose name starts with the given prefix.
 *
 * A `.deb` is an `ar` archive of `debian-binary`, `control.tar.*` and
 * `data.tar.*`, in that order, and the compression suffix varies by whoever
 * built it.
 */
export async function findDebArchiveMember(
  source: DebArchiveSource,
  namePrefix: string,
): Promise<DebArchiveMember> {
  const head = await source.read(0, Math.min(source.size, HEAD_READ_SIZE));
  if (textDecoder.decode(head.subarray(0, arGlobalHeader.length)) !== arGlobalHeader) {
    throw new DebControlParseError("APT artifact is not a Debian package archive");
  }

  let offset = arGlobalHeader.length;
  while (offset + AR_HEADER_SIZE <= source.size) {
    const header = offset + AR_HEADER_SIZE <= head.byteLength
      ? head.subarray(offset, offset + AR_HEADER_SIZE)
      : await source.read(offset, AR_HEADER_SIZE);
    const member = parseArHeader(header);

    const dataStart = offset + AR_HEADER_SIZE;
    if (dataStart + member.size > source.size) {
      throw new DebControlParseError("APT artifact Debian archive is truncated");
    }
    if (member.name.startsWith(namePrefix)) {
      return { name: member.name, offset: dataStart, size: member.size };
    }

    offset = dataStart + member.size + (member.size % 2);
  }

  throw new DebControlParseError(`APT artifact does not contain ${namePrefix}`);
}

function parseArHeader(header: Uint8Array): { name: string; size: number } {
  const text = textDecoder.decode(header);
  const name = text.slice(0, 16).trim().replace(/\/$/, "");
  const size = Number.parseInt(text.slice(48, 58).trim(), 10);
  if (text.slice(58, 60) !== "`\n" || !Number.isFinite(size) || size < 0) {
    throw new DebControlParseError("APT artifact has an invalid Debian archive header");
  }
  return { name, size };
}

/**
 * Decompresses an archive member according to the suffix in its name.
 *
 * Streams rather than buffers: listing the paths in a data archive of several
 * gigabytes should not need it all in memory at once.
 */
export function decompressDebArchiveMember(
  source: DebArchiveSource,
  member: DebArchiveMember,
): ByteStream {
  const compressed = source.stream(member.offset, member.size);

  if (member.name.endsWith(".gz")) {
    return compressed.pipeThrough(new DecompressionStream("gzip"));
  }
  if (member.name.endsWith(".xz")) {
    return new XzReadableStream(compressed) as unknown as ByteStream;
  }
  if (member.name.endsWith(".zst")) {
    return zstdStream(compressed);
  }
  if (member.name.endsWith(".tar")) {
    return compressed;
  }
  throw new DebControlParseError(`APT artifact archive compression is not supported: ${member.name}`);
}

/** WebCrypto's DecompressionStream has no zstd, which is what dpkg now defaults to. */
function zstdStream(source: ByteStream): ByteStream {
  const reader = source.getReader();
  const ready: ByteChunk[] = [];
  const decompressor = new ZstdDecompress((chunk) => ready.push(chunk as ByteChunk));
  let finished = false;

  // Compressed input is pulled only when the consumer has run out, so what is
  // held is one input chunk's worth of output rather than the whole archive.
  return new ReadableStream<ByteChunk>({
    async pull(controller) {
      while (ready.length === 0) {
        if (finished) {
          controller.close();
          return;
        }
        const next = await reader.read();
        if (next.done) {
          decompressor.push(new Uint8Array(0), true);
          finished = true;
        } else {
          decompressor.push(next.value);
        }
      }
      const chunk = ready.shift();
      if (chunk) {
        controller.enqueue(chunk);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
    },
  });
}
