import { describe, expect, it } from "vitest";
import {
  JSON_CONTENT_TYPE,
  MemoryRepositoryObjectStore,
  R2RepositoryObjectStore,
  type R2JsonBucket,
} from "./repository-object-store";

class FakeR2Bucket implements R2JsonBucket {
  readonly puts: Array<{
    key: string;
    value: string | Uint8Array | ReadableStream;
    options?: { httpMetadata?: { contentType?: string } };
  }> = [];
  failArrayBufferReads = false;

  async get(key: string) {
    const object = [...this.puts].reverse().find((put) => put.key === key);
    if (!object) {
      return null;
    }

    return {
      ...(object.options?.httpMetadata ? { httpMetadata: object.options.httpMetadata } : {}),
      body: streamFromStoredValue(object.value),
      arrayBuffer: async () => {
        if (this.failArrayBufferReads) {
          throw new Error("arrayBuffer should not be used");
        }
        if (typeof object.value === "string") {
          return arrayBufferFromBytes(new TextEncoder().encode(object.value));
        }
        if (object.value instanceof ReadableStream) {
          return arrayBufferFromBytes(await readStream(object.value));
        }
        return arrayBufferFromBytes(object.value);
      },
    };
  }

  async put(
    key: string,
    value: string | Uint8Array | ReadableStream,
    options?: { httpMetadata?: { contentType?: string } },
  ) {
    this.puts.push(options === undefined ? { key, value } : { key, value, options });
  }
}

function arrayBufferFromBytes(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function streamFromStoredValue(value: string | Uint8Array | ReadableStream): ReadableStream {
  if (value instanceof ReadableStream) {
    return value;
  }
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function readStream(stream: ReadableStream): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    const chunk = result.value instanceof Uint8Array
      ? result.value
      : new Uint8Array(result.value);
    chunks.push(chunk);
    total += chunk.byteLength;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

describe("MemoryRepositoryObjectStore", () => {
  it("captures JSON objects by key", async () => {
    const store = new MemoryRepositoryObjectStore();
    const value = { repository: "debian-internal" };

    await store.putJson("repositories/debian-internal/latest.json", value);

    expect(store.objects).toEqual([
      {
        key: "repositories/debian-internal/latest.json",
        value,
      },
    ]);
  });

  it("snapshots JSON objects when they are written", async () => {
    const store = new MemoryRepositoryObjectStore();
    const value = { nested: { ok: true } };

    await store.putJson("key.json", value);
    value.nested.ok = false;

    expect(store.objects[0]?.value).toEqual({ nested: { ok: true } });
  });

  it("captures text objects with content metadata", async () => {
    const store = new MemoryRepositoryObjectStore();

    await store.putText("dists/noble/Release", "Origin: Axis\n", "text/plain");

    expect(store.objects).toEqual([
      {
        key: "dists/noble/Release",
        value: "Origin: Axis\n",
        contentType: "text/plain",
      },
    ]);
  });

  it("captures byte objects with content metadata and snapshots bytes", async () => {
    const store = new MemoryRepositoryObjectStore();
    const bytes = new Uint8Array([1, 2, 3]);

    await store.putBytes("pool/pkg.deb", bytes, "application/vnd.debian.binary-package");
    bytes[0] = 9;

    expect(store.objects).toEqual([
      {
        key: "pool/pkg.deb",
        value: new Uint8Array([1, 2, 3]),
        contentType: "application/vnd.debian.binary-package",
      },
    ]);
  });

  it("copies memory objects with cloned values and source content type", async () => {
    const store = new MemoryRepositoryObjectStore();
    const bytes = new Uint8Array([4, 5, 6]);
    await store.putBytes("staging/pkg.deb", bytes, "application/octet-stream");

    await store.copyObject("staging/pkg.deb", "pool/pkg.deb");
    bytes[1] = 9;

    expect(store.objects[0]).toEqual({
      key: "staging/pkg.deb",
      value: new Uint8Array([4, 5, 6]),
      contentType: "application/octet-stream",
    });
    expect(store.objects[1]).toEqual({
      key: "pool/pkg.deb",
      value: new Uint8Array([4, 5, 6]),
      contentType: "application/octet-stream",
    });
  });

  it("copies memory objects with an overridden content type", async () => {
    const store = new MemoryRepositoryObjectStore();
    await store.putText("staging/Release", "Origin: Axis\n", "text/plain");

    await store.copyObject("staging/Release", "dists/noble/Release", "text/x-debian-control");

    expect(store.objects[1]).toEqual({
      key: "dists/noble/Release",
      value: "Origin: Axis\n",
      contentType: "text/x-debian-control",
    });
  });
});

describe("R2RepositoryObjectStore", () => {
  it("writes JSON with content metadata", async () => {
    const bucket = new FakeR2Bucket();
    const store = new R2RepositoryObjectStore(bucket);

    await store.putJson("repositories/debian-internal/latest.json", { repository: "debian-internal" });

    expect(bucket.puts).toEqual([
      {
        key: "repositories/debian-internal/latest.json",
        value: JSON.stringify({ repository: "debian-internal" }),
        options: {
          httpMetadata: {
            contentType: JSON_CONTENT_TYPE,
          },
        },
      },
    ]);
  });

  it("copies R2 objects preserving source content type", async () => {
    const bucket = new FakeR2Bucket();
    bucket.failArrayBufferReads = true;
    const store = new R2RepositoryObjectStore(bucket);
    await store.putText("staging/Release", "Origin: Axis\n", "text/plain");

    await store.copyObject("staging/Release", "dists/noble/Release");

    expect(bucket.puts).toHaveLength(2);
    expect(bucket.puts[1]).toEqual({
      key: "dists/noble/Release",
      value: expect.any(ReadableStream),
      options: {
        httpMetadata: {
          contentType: "text/plain",
        },
      },
    });
    await expect(readStream(bucket.puts[1]!.value as ReadableStream)).resolves.toEqual(
      new TextEncoder().encode("Origin: Axis\n"),
    );
  });

  it("copies R2 objects with an overridden content type", async () => {
    const bucket = new FakeR2Bucket();
    bucket.failArrayBufferReads = true;
    const store = new R2RepositoryObjectStore(bucket);
    await store.putText("staging/Release", "Origin: Axis\n", "text/plain");

    await store.copyObject("staging/Release", "dists/noble/Release", "text/x-debian-control");

    expect(bucket.puts[1]).toEqual({
      key: "dists/noble/Release",
      value: expect.any(ReadableStream),
      options: {
        httpMetadata: {
          contentType: "text/x-debian-control",
        },
      },
    });
    await expect(readStream(bucket.puts[1]!.value as ReadableStream)).resolves.toEqual(
      new TextEncoder().encode("Origin: Axis\n"),
    );
  });

  it("fails R2 copy when the source object is missing", async () => {
    const bucket = new FakeR2Bucket();
    const store = new R2RepositoryObjectStore(bucket);

    await expect(store.copyObject("missing", "destination")).rejects.toThrow(
      "Object not found: missing",
    );
  });
});
