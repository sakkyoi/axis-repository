import { describe, expect, it } from "vitest";
import { zstdDecompressSync } from "node:zlib";
import { gzipSync } from "node:zlib";
import { zstdCompress } from "./zstd";

const textEncoder = new TextEncoder();

function packagesFixture(count: number): Uint8Array {
  const stanzas = Array.from({ length: count }, (_, index) => [
    `Package: pkg-${index}`,
    `Version: 1.${index}.0`,
    "Architecture: amd64",
    "Maintainer: Release Team <release@example.com>",
    `Filename: pool/main/pkg-${index}/pkg-${index}_1.0_amd64.deb`,
    "Description: A package",
    " with a longer description that repeats across the index.",
  ].join("\n"));
  return textEncoder.encode(stanzas.join("\n\n"));
}

describe("zstdCompress", () => {
  it("produces a frame the reference decompressor reads back exactly", async () => {
    const input = packagesFixture(500);

    const compressed = await zstdCompress(input);

    expect(Buffer.from(compressed.subarray(0, 4)).toString("hex")).toBe("28b52ffd");
    expect(new Uint8Array(zstdDecompressSync(Buffer.from(compressed)))).toEqual(input);
  });

  it("compresses an index well below gzip, which is the whole point of publishing it", async () => {
    const input = packagesFixture(2000);

    const compressed = await zstdCompress(input);

    expect(compressed.byteLength).toBeLessThan(gzipSync(Buffer.from(input), { level: 9 }).byteLength);
  });

  it("handles empty and tiny inputs", async () => {
    for (const input of [new Uint8Array(0), textEncoder.encode("x")]) {
      const compressed = await zstdCompress(input);
      expect(new Uint8Array(zstdDecompressSync(Buffer.from(compressed)))).toEqual(input);
    }
  });

  it("initializes the WebAssembly module only once across calls", async () => {
    // A second call must not re-enter init; the loader aborts if it does.
    await expect(Promise.all([
      zstdCompress(textEncoder.encode("one")),
      zstdCompress(textEncoder.encode("two")),
    ])).resolves.toHaveLength(2);
  });
});
