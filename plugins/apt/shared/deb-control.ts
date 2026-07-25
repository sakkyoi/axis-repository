import { XzReadableStream } from "xz-decompress";

export type DebControlMetadata = Record<string, string>;

export class DebControlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DebControlParseError";
  }
}

const textDecoder = new TextDecoder();
const arGlobalHeader = "!<arch>\n";

export async function readDebControlMetadata(bytes: Uint8Array): Promise<DebControlMetadata> {
  const controlArchive = readDebControlArchive(bytes);
  const controlText = await readControlFile(controlArchive);
  return parseDebianControl(controlText);
}

function readDebControlArchive(bytes: Uint8Array): { name: string; bytes: Uint8Array } {
  if (textDecoder.decode(bytes.slice(0, arGlobalHeader.length)) !== arGlobalHeader) {
    throw new DebControlParseError("APT artifact is not a Debian package archive");
  }

  let offset = arGlobalHeader.length;
  while (offset + 60 <= bytes.byteLength) {
    const header = textDecoder.decode(bytes.slice(offset, offset + 60));
    const name = header.slice(0, 16).trim().replace(/\/$/, "");
    const sizeText = header.slice(48, 58).trim();
    const trailer = header.slice(58, 60);
    const size = Number.parseInt(sizeText, 10);
    if (trailer !== "`\n" || !Number.isFinite(size) || size < 0) {
      throw new DebControlParseError("APT artifact has an invalid Debian archive header");
    }

    const dataStart = offset + 60;
    const dataEnd = dataStart + size;
    if (dataEnd > bytes.byteLength) {
      throw new DebControlParseError("APT artifact Debian archive is truncated");
    }

    if (name.startsWith("control.tar")) {
      return { name, bytes: bytes.slice(dataStart, dataEnd) };
    }

    offset = dataEnd + (size % 2);
  }

  throw new DebControlParseError("APT artifact does not contain control metadata");
}

async function readControlFile(controlArchive: { name: string; bytes: Uint8Array }): Promise<string> {
  if (controlArchive.name === "control.tar.xz") {
    return readControlFileFromTarXz(controlArchive.bytes);
  }
  const controlTar = await decompressControlArchive(controlArchive);
  return readControlFileFromTar(controlTar);
}

async function decompressControlArchive(controlArchive: { name: string; bytes: Uint8Array }): Promise<Uint8Array> {
  if (controlArchive.name === "control.tar") {
    return controlArchive.bytes;
  }
  if (controlArchive.name === "control.tar.gz") {
    return gunzip(controlArchive.bytes);
  }
  throw new DebControlParseError(`APT artifact control archive is not supported: ${controlArchive.name}`);
}

async function readControlFileFromTarXz(bytes: Uint8Array): Promise<string> {
  return readControlFileFromTar(await unxz(bytes));
}

function readControlFileFromTar(bytes: Uint8Array): string {
  let offset = 0;
  while (offset + 512 <= bytes.byteLength) {
    const header = bytes.slice(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      break;
    }

    const name = readNullTerminatedText(header.slice(0, 100));
    const sizeText = readNullTerminatedText(header.slice(124, 136)).trim();
    const size = Number.parseInt(sizeText || "0", 8);
    if (!Number.isFinite(size) || size < 0) {
      throw new DebControlParseError("APT artifact control tar header is invalid");
    }

    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > bytes.byteLength) {
      throw new DebControlParseError("APT artifact control tar is truncated");
    }

    if (name === "control" || name === "./control") {
      return textDecoder.decode(bytes.slice(dataStart, dataEnd));
    }

    offset = dataStart + Math.ceil(size / 512) * 512;
  }

  throw new DebControlParseError("APT artifact control archive does not contain a control file");
}

export function parseDebianControl(text: string): DebControlMetadata {
  const metadata: DebControlMetadata = {};
  let currentField = "";

  for (const rawLine of text.replace(/\r\n/g, "\n").split("\n")) {
    if (!rawLine) {
      continue;
    }
    if (/^[ \t]/.test(rawLine)) {
      if (currentField) {
        metadata[currentField] = `${metadata[currentField] ?? ""} ${rawLine.trim()}`.trim();
      }
      continue;
    }

    const separator = rawLine.indexOf(":");
    if (separator <= 0) {
      throw new DebControlParseError("APT artifact control metadata is invalid");
    }
    currentField = rawLine.slice(0, separator).toLowerCase();
    metadata[currentField] = rawLine.slice(separator + 1).trim();
  }

  return metadata;
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== "undefined") {
    const stream = new Blob([arrayBufferFromBytes(bytes)]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  const dynamicImport = new Function("specifier", "return import(specifier)") as (
    specifier: string,
  ) => Promise<{ gunzipSync(input: Uint8Array): Uint8Array }>;
  const { gunzipSync } = await dynamicImport("node:zlib");
  return new Uint8Array(gunzipSync(bytes));
}

async function unxz(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new XzReadableStream(new Blob([arrayBufferFromBytes(bytes)]).stream());
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function readNullTerminatedText(bytes: Uint8Array): string {
  const end = bytes.indexOf(0);
  return textDecoder.decode(end === -1 ? bytes : bytes.slice(0, end));
}

function arrayBufferFromBytes(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
