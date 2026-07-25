import { describe, expect, it } from "vitest";
import {
  JSON_CONTENT_TYPE,
  MemoryRepositoryObjectStore,
  R2RepositoryObjectStore,
  type R2ObjectBucket,
  type R2ReadableObject,
} from "./repository-object-store";

class FakeR2Bucket implements R2ObjectBucket {
  readonly puts: Array<{
    key: string;
    value: string | Uint8Array | ReadableStream;
    options?: { httpMetadata?: { contentType?: string } };
  }> = [];
  readonly getCalls: Array<{
    key: string;
    options?: { range?: { offset: number; length: number } };
  }> = [];
  readonly deletes: string[] = [];
  failArrayBufferReads = false;

  async head(key: string): Promise<R2ReadableObject | null> {
    const object = [...this.puts].reverse().find((put) => put.key === key);
    if (!object) {
      return null;
    }
    const bytes = await bytesFromStoredValue(object.value);
    return {
      ...(object.options?.httpMetadata ? { httpMetadata: object.options.httpMetadata } : {}),
      etag: `fake-${bytes.byteLength}`,
      httpEtag: `"fake-${bytes.byteLength}"`,
      size: bytes.byteLength,
      arrayBuffer: async () => arrayBufferFromBytes(bytes),
    };
  }

  async get(
    key: string,
    options?: { range?: { offset: number; length: number } },
  ): Promise<R2ReadableObject | null> {
    this.getCalls.push(options === undefined ? { key } : { key, options });
    const object = [...this.puts].reverse().find((put) => put.key === key);
    if (!object) {
      return null;
    }
    const bytes = await bytesFromStoredValue(object.value);
    const bodyBytes = options?.range
      ? bytes.slice(options.range.offset, options.range.offset + options.range.length)
      : bytes;

    return {
      ...(object.options?.httpMetadata ? { httpMetadata: object.options.httpMetadata } : {}),
      etag: `fake-${bytes.byteLength}`,
      httpEtag: `"fake-${bytes.byteLength}"`,
      size: bytes.byteLength,
      body: streamFromBytes(bodyBytes),
      arrayBuffer: async () => {
        if (this.failArrayBufferReads) {
          throw new Error("arrayBuffer should not be used");
        }
        return arrayBufferFromBytes(bodyBytes);
      },
    };
  }

  async list(options: { prefix?: string; delimiter?: string; cursor?: string; limit?: number } = {}) {
    const latest = new Map<string, typeof this.puts[number]>();
    for (const put of this.puts) {
      latest.set(put.key, put);
    }
    const objects = [];
    const delimitedPrefixes = new Set<string>();
    for (const object of [...latest.values()].sort((left, right) => left.key.localeCompare(right.key))) {
      if (options.prefix && !object.key.startsWith(options.prefix)) {
        continue;
      }
      const rest = object.key.slice(options.prefix?.length ?? 0);
      const delimiterIndex = options.delimiter ? rest.indexOf(options.delimiter) : -1;
      if (options.delimiter && delimiterIndex >= 0) {
        delimitedPrefixes.add(`${options.prefix ?? ""}${rest.slice(0, delimiterIndex + options.delimiter.length)}`);
        continue;
      }
      const bytes = await bytesFromStoredValue(object.value);
      objects.push({
        key: object.key,
        ...(object.options?.httpMetadata ? { httpMetadata: object.options.httpMetadata } : {}),
        httpEtag: `"fake-${bytes.byteLength}"`,
        size: bytes.byteLength,
      });
    }
    return {
      objects,
      delimitedPrefixes: [...delimitedPrefixes].sort((left, right) => left.localeCompare(right)),
      truncated: false,
    };
  }

  async put(
    key: string,
    value: string | Uint8Array | ReadableStream,
    options?: { httpMetadata?: { contentType?: string } },
  ) {
    this.puts.push(options === undefined ? { key, value } : { key, value, options });
  }

  async delete(key: string) {
    this.deletes.push(key);
    const previousLength = this.puts.length;
    for (let index = this.puts.length - 1; index >= 0; index -= 1) {
      if (this.puts[index]?.key === key) {
        this.puts.splice(index, 1);
      }
    }
    return previousLength !== this.puts.length;
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
  return streamFromBytes(bytes);
}

function streamFromBytes(bytes: Uint8Array): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function bytesFromStoredValue(value: string | Uint8Array | ReadableStream): Promise<Uint8Array> {
  if (typeof value === "string") {
    return new TextEncoder().encode(value);
  }
  if (value instanceof ReadableStream) {
    return readStream(value);
  }
  return new Uint8Array(value);
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

  it("reads memory JSON objects as serialized JSON with content metadata", async () => {
    const store = new MemoryRepositoryObjectStore();

    await store.putJson("repositories/debian/latest.json", { repository: "debian" });

    const object = await store.getObject("repositories/debian/latest.json");

    expect(object).toMatchObject({
      body: JSON.stringify({ repository: "debian" }),
      contentType: JSON_CONTENT_TYPE,
      contentLength: 23,
    });
    expect(object?.etag).toMatch(/^"[a-f0-9]{64}"$/);
  });

  it("reads memory objects with length and deterministic etag metadata", async () => {
    const store = new MemoryRepositoryObjectStore();
    await store.putText(
      "repositories/debian/dists/noble/InRelease",
      "signed release",
      "text/plain",
    );

    const object = await store.getObject("repositories/debian/dists/noble/InRelease");

    expect(object).toMatchObject({
      body: "signed release",
      contentType: "text/plain",
      contentLength: 14,
    });
    expect(object?.etag).toMatch(/^"[a-f0-9]{64}"$/);
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

  it("reads the latest memory text object with content metadata", async () => {
    const store = new MemoryRepositoryObjectStore();
    await store.putText("repositories/debian/dists/noble/Release", "old", "text/plain");
    await store.putText(
      "repositories/debian/dists/noble/Release",
      "new",
      "text/plain; charset=utf-8",
    );

    const object = await store.getObject("repositories/debian/dists/noble/Release");

    expect(object).toMatchObject({
      body: "new",
      contentType: "text/plain; charset=utf-8",
      contentLength: 3,
    });
    expect(object?.etag).toMatch(/^"[a-f0-9]{64}"$/);
  });

  it("reads memory byte objects as immutable snapshots", async () => {
    const store = new MemoryRepositoryObjectStore();
    const bytes = new Uint8Array([1, 2, 3]);
    await store.putBytes(
      "repositories/debian/pool/main/app.deb",
      bytes,
      "application/vnd.debian.binary-package",
    );
    bytes[0] = 9;

    const object = await store.getObject("repositories/debian/pool/main/app.deb");

    expect(object).toMatchObject({
      body: new Uint8Array([1, 2, 3]),
      contentType: "application/vnd.debian.binary-package",
      contentLength: 3,
    });
    expect(object?.etag).toMatch(/^"[a-f0-9]{64}"$/);
  });

  it("reads byte ranges from memory objects", async () => {
    const store = new MemoryRepositoryObjectStore();
    await store.putText(
      "repositories/debian/pool/main/app.deb",
      "0123456789",
      "application/vnd.debian.binary-package",
    );

    const object = await store.getObject("repositories/debian/pool/main/app.deb", {
      range: { offset: 2, length: 4 },
    });

    expect(object).toMatchObject({
      body: "2345",
      contentType: "application/vnd.debian.binary-package",
      contentLength: 10,
      range: { offset: 2, length: 4 },
    });
  });

  it("returns null for missing memory objects", async () => {
    const store = new MemoryRepositoryObjectStore();

    await expect(store.getObject("repositories/debian/missing")).resolves.toBeNull();
  });

  it("deletes the latest memory object by key", async () => {
    const store = new MemoryRepositoryObjectStore();
    await store.putText("repositories/debian/pool/app.deb", "old", "text/plain");
    await store.putText("repositories/debian/pool/app.deb", "new", "text/plain");

    await expect(store.deleteObject("repositories/debian/pool/app.deb")).resolves.toBe(true);

    await expect(store.getObject("repositories/debian/pool/app.deb")).resolves.toBeNull();
    await expect(store.deleteObject("repositories/debian/pool/app.deb")).resolves.toBe(false);
  });

  it("lists memory objects by prefix and delimiter as a repository tree", async () => {
    const store = new MemoryRepositoryObjectStore();
    await store.putText("repositories/debian/dists/noble/Release", "release", "text/plain");
    await store.putText("repositories/debian/dists/noble/main/binary-amd64/Packages", "packages", "text/plain");
    await store.putBytes("repositories/debian/pool/main/myapp/myapp_1.0.0_amd64.deb", new Uint8Array([1]), "application/vnd.debian.binary-package");
    await store.putText("repositories/other/ignored", "ignored", "text/plain");

    await expect(store.listObjects({
      prefix: "repositories/debian/",
      delimiter: "/",
    })).resolves.toEqual({
      prefix: "repositories/debian/",
      directories: [
        { path: "repositories/debian/dists/" },
        { path: "repositories/debian/pool/" },
      ],
      objects: [],
      truncated: false,
    });

    await expect(store.listObjects({
      prefix: "repositories/debian/dists/noble/",
      delimiter: "/",
    })).resolves.toMatchObject({
      prefix: "repositories/debian/dists/noble/",
      directories: [{ path: "repositories/debian/dists/noble/main/" }],
      objects: [{
        key: "repositories/debian/dists/noble/Release",
        contentType: "text/plain",
        contentLength: 7,
      }],
      truncated: false,
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

  it("writes text with content metadata", async () => {
    const bucket = new FakeR2Bucket();
    const store = new R2RepositoryObjectStore(bucket);

    await store.putText("dists/noble/Release", "Origin: Axis\n", "text/plain");

    expect(bucket.puts).toEqual([
      {
        key: "dists/noble/Release",
        value: "Origin: Axis\n",
        options: {
          httpMetadata: {
            contentType: "text/plain",
          },
        },
      },
    ]);
  });

  it("writes bytes with content metadata and snapshots byte input", async () => {
    const bucket = new FakeR2Bucket();
    const store = new R2RepositoryObjectStore(bucket);
    const bytes = new Uint8Array([1, 2, 3]);

    await store.putBytes("pool/pkg.deb", bytes, "application/vnd.debian.binary-package");
    bytes[0] = 9;

    expect(bucket.puts).toEqual([
      {
        key: "pool/pkg.deb",
        value: new Uint8Array([1, 2, 3]),
        options: {
          httpMetadata: {
            contentType: "application/vnd.debian.binary-package",
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

  it("reads R2 objects preserving content type and stream body", async () => {
    const bucket = new FakeR2Bucket();
    bucket.failArrayBufferReads = true;
    const store = new R2RepositoryObjectStore(bucket);
    await store.putBytes(
      "repositories/debian/pool/main/app.deb",
      new Uint8Array([1, 2, 3]),
      "application/vnd.debian.binary-package",
    );

    const object = await store.getObject("repositories/debian/pool/main/app.deb");

    expect(object?.contentType).toBe("application/vnd.debian.binary-package");
    await expect(readStream(object?.body as ReadableStream)).resolves.toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it("reads ranged objects from R2 with metadata", async () => {
    const bucket = new FakeR2Bucket();
    await bucket.put(
      "repositories/debian/pool/main/app.deb",
      new TextEncoder().encode("0123456789"),
      {
        httpMetadata: { contentType: "application/vnd.debian.binary-package" },
      },
    );
    const store = new R2RepositoryObjectStore(bucket);

    const object = await store.getObject("repositories/debian/pool/main/app.deb", {
      range: { offset: 3, length: 4 },
    });

    expect(object).toMatchObject({
      contentType: "application/vnd.debian.binary-package",
      contentLength: 10,
      etag: "\"fake-10\"",
      range: { offset: 3, length: 4 },
    });
    await expect(new Response(object?.body).text()).resolves.toBe("3456");
    expect(bucket.getCalls.at(-1)).toMatchObject({
      key: "repositories/debian/pool/main/app.deb",
      options: { range: { offset: 3, length: 4 } },
    });
  });

  it("reads R2 object heads with HTTP-safe etag metadata", async () => {
    const bucket = new FakeR2Bucket();
    await bucket.put(
      "repositories/debian/dists/noble/InRelease",
      "signed release",
      { httpMetadata: { contentType: "text/plain" } },
    );
    const store = new R2RepositoryObjectStore(bucket);

    const metadata = await store.headObject("repositories/debian/dists/noble/InRelease");

    expect(metadata).toEqual({
      contentType: "text/plain",
      contentLength: 14,
      etag: "\"fake-14\"",
    });
  });

  it("falls back to R2 arrayBuffer when no body stream exists", async () => {
    const bucket = new FakeR2Bucket();
    const store = new R2RepositoryObjectStore(bucket);
    await store.putText(
      "repositories/debian/dists/noble/Release",
      "release",
      "text/plain; charset=utf-8",
    );
    const originalGet = bucket.get.bind(bucket);
    bucket.get = async (key: string) => {
      const object = await originalGet(key);
      if (!object) {
        return null;
      }
      const { body: _body, ...withoutBody } = object;
      return withoutBody;
    };

    const object = await store.getObject("repositories/debian/dists/noble/Release");

    expect(object).toMatchObject({
      body: new TextEncoder().encode("release"),
      contentType: "text/plain; charset=utf-8",
      contentLength: 7,
      etag: "\"fake-7\"",
    });
  });

  it("returns null for missing R2 objects", async () => {
    const store = new R2RepositoryObjectStore(new FakeR2Bucket());

    await expect(store.getObject("repositories/debian/missing")).resolves.toBeNull();
  });

  it("deletes R2 objects by key", async () => {
    const bucket = new FakeR2Bucket();
    const store = new R2RepositoryObjectStore(bucket);
    await store.putText("repositories/debian/pool/app.deb", "content", "text/plain");

    await expect(store.deleteObject("repositories/debian/pool/app.deb")).resolves.toBe(true);

    expect(bucket.deletes).toEqual(["repositories/debian/pool/app.deb"]);
    await expect(store.headObject("repositories/debian/pool/app.deb")).resolves.toBeNull();
  });

  it("lists R2 objects by prefix and delimiter", async () => {
    const bucket = new FakeR2Bucket();
    await bucket.put("repositories/debian/dists/noble/Release", "release", { httpMetadata: { contentType: "text/plain" } });
    await bucket.put("repositories/debian/dists/noble/main/binary-amd64/Packages", "packages", { httpMetadata: { contentType: "text/plain" } });
    const store = new R2RepositoryObjectStore(bucket);

    await expect(store.listObjects({
      prefix: "repositories/debian/dists/noble/",
      delimiter: "/",
    })).resolves.toEqual({
      prefix: "repositories/debian/dists/noble/",
      directories: [{ path: "repositories/debian/dists/noble/main/" }],
      objects: [{
        key: "repositories/debian/dists/noble/Release",
        contentType: "text/plain",
        contentLength: 7,
        etag: "\"fake-7\"",
      }],
      truncated: false,
    });
  });
});
