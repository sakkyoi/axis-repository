import { gzipSync } from "node:zlib";

const textEncoder = new TextEncoder();

export function debArchive(input: { control: string }): Uint8Array {
  return arArchive([
    { name: "debian-binary", bytes: textEncoder.encode("2.0\n") },
    { name: "control.tar.gz", bytes: new Uint8Array(gzipSync(tarArchive([{ name: "./control", bytes: textEncoder.encode(input.control) }]))) },
    { name: "data.tar.gz", bytes: new Uint8Array(gzipSync(tarArchive([]))) },
  ]);
}

function arArchive(entries: Array<{ name: string; bytes: Uint8Array }>): Uint8Array {
  const chunks: Uint8Array[] = [textEncoder.encode("!<arch>\n")];
  for (const entry of entries) {
    const name = `${entry.name}/`.padEnd(16, " ");
    const header = `${name}${"0".padEnd(12, " ")}${"0".padEnd(6, " ")}${"0".padEnd(6, " ")}${"100644".padEnd(8, " ")}${String(entry.bytes.byteLength).padEnd(10, " ")}\`\n`;
    chunks.push(textEncoder.encode(header), entry.bytes);
    if (entry.bytes.byteLength % 2) {
      chunks.push(textEncoder.encode("\n"));
    }
  }
  return concatBytes(chunks);
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
    chunks.push(header, entry.bytes, new Uint8Array(Math.ceil(entry.bytes.byteLength / 512) * 512 - entry.bytes.byteLength));
  }
  chunks.push(new Uint8Array(1024));
  return concatBytes(chunks);
}

function writeAscii(target: Uint8Array, offset: number, length: number, value: string): void {
  target.set(textEncoder.encode(value).slice(0, length), offset);
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
