import { describe, expect, it } from "vitest";
import { digestHex, digestStreamHex, type DigestAlgorithm } from "./digest";

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      const chunk = chunks[index];
      index += 1;
      if (chunk === undefined) {
        controller.close();
        return;
      }
      controller.enqueue(chunk as never);
    },
  });
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function pattern(length: number, seed: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    bytes[index] = (index * 31 + seed) % 251;
  }
  return bytes;
}

const ALGORITHMS: DigestAlgorithm[] = ["SHA-1", "SHA-256", "SHA-512"];

describe("digestStreamHex", () => {
  it.each(ALGORITHMS)("matches a one-shot %s digest", async (algorithm) => {
    const chunks = [pattern(1000, 1), pattern(7, 2), pattern(4096, 3)];

    await expect(digestStreamHex(algorithm, streamOf(chunks)))
      .resolves.toBe(await digestHex(algorithm, concat(chunks)));
  });

  it("digests an empty stream", async () => {
    await expect(digestStreamHex("SHA-256", streamOf([])))
      .resolves.toBe(await digestHex("SHA-256", new Uint8Array(0)));
  });

  it("does not depend on where the chunk boundaries fall", async () => {
    // A hash that only accumulated the last chunk, or lost one, would still
    // agree with itself; it has to agree with the whole input's digest.
    const whole = pattern(256 * 1024 + 17, 5);
    const oneShot = await digestHex("SHA-256", whole);

    for (const size of [1, 64, 512, 1024 * 1024]) {
      const chunks: Uint8Array[] = [];
      for (let offset = 0; offset < whole.byteLength; offset += size) {
        chunks.push(whole.subarray(offset, Math.min(offset + size, whole.byteLength)));
      }
      await expect(digestStreamHex("SHA-256", streamOf(chunks))).resolves.toBe(oneShot);
    }
  });

  it("tells two inputs of the same length apart", async () => {
    const left = await digestStreamHex("SHA-256", streamOf([pattern(4096, 1)]));
    const right = await digestStreamHex("SHA-256", streamOf([pattern(4096, 2)]));

    expect(left).not.toBe(right);
  });
});
