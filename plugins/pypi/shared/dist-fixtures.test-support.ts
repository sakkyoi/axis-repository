/**
 * Builds real distributions for tests, without needing Python installed.
 *
 * Entries are stored rather than deflated, which a zip reader must accept
 * anyway. The archives that check this code against what Python actually
 * writes live in the archive and metadata tests; these exist so the publish
 * pipeline can be exercised anywhere.
 */

const textEncoder = new TextEncoder();

export interface WheelFixture {
  /** Defaults to a metadata document matching the name and version given. */
  metadata?: string;
  name: string;
  version: string;
}

export function wheelBytes(input: WheelFixture): Uint8Array {
  const distInfo = `${input.name.replace(/[-.]/g, "_")}-${input.version}.dist-info`;
  const metadata = input.metadata ?? [
    "Metadata-Version: 2.1",
    `Name: ${input.name}`,
    `Version: ${input.version}`,
    "",
    "A test distribution.",
  ].join("\n");

  return zipArchive([
    { name: `${distInfo}/METADATA`, bytes: textEncoder.encode(metadata) },
    { name: `${distInfo}/WHEEL`, bytes: textEncoder.encode("Wheel-Version: 1.0\n") },
  ]);
}

export interface SdistFixture {
  metadata?: string;
  name: string;
  version: string;
}

export async function sdistBytes(input: SdistFixture): Promise<Uint8Array> {
  const metadata = input.metadata ?? [
    "Metadata-Version: 2.1",
    `Name: ${input.name}`,
    `Version: ${input.version}`,
    "",
    "A test distribution.",
  ].join("\n");
  const root = `${input.name}-${input.version}`;

  return gzip(tarArchive([
    { name: `${root}/PKG-INFO`, bytes: textEncoder.encode(metadata) },
    { name: `${root}/setup.py`, bytes: textEncoder.encode("# setup\n") },
  ]));
}

/** Uses the platform's own compression, so this runs in a browser too. */
async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream as ReadableStream).arrayBuffer());
}

const STORED = 0;

function zipArchive(entries: Array<{ name: string; bytes: Uint8Array }>): Uint8Array {
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = textEncoder.encode(entry.name);
    const crc = crc32(entry.bytes);

    const header = new Uint8Array(30 + name.byteLength);
    const headerView = new DataView(header.buffer);
    headerView.setUint32(0, 0x04034b50, true);
    headerView.setUint16(4, 20, true);
    headerView.setUint16(8, STORED, true);
    headerView.setUint32(14, crc, true);
    headerView.setUint32(18, entry.bytes.byteLength, true);
    headerView.setUint32(22, entry.bytes.byteLength, true);
    headerView.setUint16(26, name.byteLength, true);
    header.set(name, 30);

    const directory = new Uint8Array(46 + name.byteLength);
    const directoryView = new DataView(directory.buffer);
    directoryView.setUint32(0, 0x02014b50, true);
    directoryView.setUint16(4, 20, true);
    directoryView.setUint16(6, 20, true);
    directoryView.setUint16(10, STORED, true);
    directoryView.setUint32(16, crc, true);
    directoryView.setUint32(20, entry.bytes.byteLength, true);
    directoryView.setUint32(24, entry.bytes.byteLength, true);
    directoryView.setUint16(28, name.byteLength, true);
    directoryView.setUint32(42, offset, true);
    directory.set(name, 46);

    local.push(header, entry.bytes);
    central.push(directory);
    offset += header.byteLength + entry.bytes.byteLength;
  }

  const centralBytes = concat(central);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralBytes.byteLength, true);
  endView.setUint32(16, offset, true);

  return concat([...local, centralBytes, end]);
}

function tarArchive(entries: Array<{ name: string; bytes: Uint8Array }>): Uint8Array {
  const chunks: Uint8Array[] = [];

  for (const entry of entries) {
    const header = new Uint8Array(512);
    writeAscii(header, 0, 100, entry.name);
    writeAscii(header, 100, 8, "0000644");
    writeAscii(header, 108, 8, "0000000");
    writeAscii(header, 116, 8, "0000000");
    writeAscii(header, 124, 12, entry.bytes.byteLength.toString(8).padStart(11, "0"));
    writeAscii(header, 136, 12, "00000000000");
    header.fill(0x20, 148, 156);
    header[156] = "0".charCodeAt(0);
    writeAscii(header, 257, 6, "ustar");
    writeAscii(header, 263, 2, "00");
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    writeAscii(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
    chunks.push(
      header,
      entry.bytes,
      new Uint8Array((512 - (entry.bytes.byteLength % 512)) % 512),
    );
  }

  chunks.push(new Uint8Array(1024));
  return concat(chunks);
}

let crcTable: Uint32Array | undefined;

function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      crcTable[index] = value >>> 0;
    }
  }

  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeAscii(target: Uint8Array, offset: number, length: number, value: string): void {
  target.set(textEncoder.encode(value).slice(0, length), offset);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
