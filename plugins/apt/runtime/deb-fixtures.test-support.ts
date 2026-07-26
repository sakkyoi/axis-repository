import { gzipSync, zstdCompressSync } from "node:zlib";

const textEncoder = new TextEncoder();
const controlTarXzFixture = "/Td6WFoAAAD/EtlBAgAhARAAAACocI6G4Af/AMJdABcLyOfZ5dHD1ZV9QtvcDlxsYucUrl4il7Em4XY0Mmd4zWXKEX3pitNZrbsmPuAzpPUTPlKd1qZVDG1Acr4sFRHL4NJBXzydVA0vPWjnh1EiddFNfqoRi2rrxPowSYh9MVzmNBmBU+1RIR7MAcn7ctJ7BrY8agbeeed+zaXN7OXvRN+9m+1W9shuvrCZbgmNVOk64sgLWiqFgQe6e5Hd80LEr10DRDEhkUJmlSaDhfDYxDgz2DaHGHuMv1isUN1SNQwAAAAAAAHWAYAQAAAUFy3LqAAK/AIAAAAAAFla";

export async function debArchiveWithControlXz(input: { control: string }): Promise<Uint8Array> {
  const expectedControl = [
    "Package: myapp",
    "Version: 1.2.3",
    "Architecture: amd64",
    "Maintainer: Release Team <release@example.com>",
    "Description: Example package",
    "Depends: libc6",
    "",
  ].join("\n");
  if (input.control !== expectedControl) {
    throw new Error("The xz Debian fixture is static; update controlTarXzFixture for this control content.");
  }
  return arArchive([
    { name: "debian-binary", bytes: textEncoder.encode("2.0\n") },
    { name: "control.tar.xz", bytes: base64Bytes(controlTarXzFixture) },
    { name: "data.tar.gz", bytes: new Uint8Array(gzipSync(tarArchive([]))) },
  ]);
}

export interface DebArchiveInput {
  control: string;
  /** Paths the package installs, as `Contents` would list them. */
  files?: string[];
  /** How the data archive is compressed; dpkg now defaults to zstd. */
  dataCompression?: "gzip" | "zstd" | "none";
}

export function debArchive(input: DebArchiveInput): Uint8Array {
  const data = tarArchive((input.files ?? []).map((path) => ({
    name: `./${path}`,
    bytes: textEncoder.encode(`contents of ${path}\n`),
  })));

  return arArchive([
    { name: "debian-binary", bytes: textEncoder.encode("2.0\n") },
    { name: "control.tar.gz", bytes: new Uint8Array(gzipSync(tarArchive([{ name: "./control", bytes: textEncoder.encode(input.control) }]))) },
    dataMember(data, input.dataCompression ?? "gzip"),
  ]);
}

function dataMember(data: Uint8Array, compression: "gzip" | "zstd" | "none"): { name: string; bytes: Uint8Array } {
  if (compression === "zstd") {
    return { name: "data.tar.zst", bytes: new Uint8Array(zstdCompressSync(data)) };
  }
  if (compression === "none") {
    return { name: "data.tar", bytes: data };
  }
  return { name: "data.tar.gz", bytes: new Uint8Array(gzipSync(data)) };
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

function base64Bytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}
