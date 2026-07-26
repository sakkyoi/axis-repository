import { Decompress as ZstdDecompress } from "fzstd";
import { XzReadableStream } from "xz-decompress";
import { DebControlParseError } from "./stanza";
import { streamFromBytes } from "./tar";

const textDecoder = new TextDecoder();
const arGlobalHeader = "!<arch>\n";
const AR_HEADER_SIZE = 60;

export interface DebArchiveMember {
  name: string;
  bytes: Uint8Array;
}

/**
 * Finds the first `ar` member whose name starts with the given prefix.
 *
 * A `.deb` is an `ar` archive of `debian-binary`, `control.tar.*` and
 * `data.tar.*`, in that order, and the compression suffix varies by whoever
 * built it.
 */
export function findDebArchiveMember(bytes: Uint8Array, namePrefix: string): DebArchiveMember {
  if (textDecoder.decode(bytes.slice(0, arGlobalHeader.length)) !== arGlobalHeader) {
    throw new DebControlParseError("APT artifact is not a Debian package archive");
  }

  let offset = arGlobalHeader.length;
  while (offset + AR_HEADER_SIZE <= bytes.byteLength) {
    const header = textDecoder.decode(bytes.slice(offset, offset + AR_HEADER_SIZE));
    const name = header.slice(0, 16).trim().replace(/\/$/, "");
    const sizeText = header.slice(48, 58).trim();
    const trailer = header.slice(58, 60);
    const size = Number.parseInt(sizeText, 10);
    if (trailer !== "`\n" || !Number.isFinite(size) || size < 0) {
      throw new DebControlParseError("APT artifact has an invalid Debian archive header");
    }

    const dataStart = offset + AR_HEADER_SIZE;
    const dataEnd = dataStart + size;
    if (dataEnd > bytes.byteLength) {
      throw new DebControlParseError("APT artifact Debian archive is truncated");
    }
    if (name.startsWith(namePrefix)) {
      return { name, bytes: bytes.slice(dataStart, dataEnd) };
    }

    offset = dataEnd + (size % 2);
  }

  throw new DebControlParseError(`APT artifact does not contain ${namePrefix}`);
}

/**
 * Decompresses an archive member according to the suffix in its name.
 *
 * Streams rather than buffers: listing the paths in a data archive of several
 * gigabytes should not need it all in memory at once.
 */
export function decompressDebArchiveMember(member: DebArchiveMember): ReadableStream<Uint8Array> {
  const source = streamFromBytes(member.bytes);

  if (member.name.endsWith(".gz")) {
    return source.pipeThrough(new DecompressionStream("gzip"));
  }
  if (member.name.endsWith(".xz")) {
    return new XzReadableStream(source) as ReadableStream<Uint8Array>;
  }
  if (member.name.endsWith(".zst")) {
    return zstdStream(source);
  }
  if (member.name.endsWith(".tar")) {
    return source;
  }
  throw new DebControlParseError(`APT artifact archive compression is not supported: ${member.name}`);
}

/** WebCrypto's DecompressionStream has no zstd, which is what dpkg now defaults to. */
function zstdStream(source: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const decompressor = new ZstdDecompress((chunk) => controller.enqueue(chunk));
      const reader = source.getReader();
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) {
            decompressor.push(new Uint8Array(0), true);
            controller.close();
            return;
          }
          decompressor.push(next.value);
        }
      } catch (error) {
        controller.error(error);
      }
    },
  });
}
