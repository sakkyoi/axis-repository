import { describe, expect, it } from "vitest";
import { MemoryUploadBroker } from "./memory-upload-broker";
import { MemoryRepositoryObjectStore } from "../storage/repository-object-store";

/** The broker takes an arriving upload, so a test body is a stream of it. */
function arriving(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new Response(bytes).body as ReadableStream<Uint8Array>;
}

/**
 * Arrives one piece per pull, and counts the pulls.
 *
 * What the broker does per piece, and how much of the body it asked for before
 * giving up, are both only visible from here.
 */
function inPieces(pieces: Uint8Array[]): { body: ReadableStream<Uint8Array>; pulled: () => number } {
  let index = 0;
  return {
    pulled: () => index,
    // No queue ahead of the reader, or a piece is pulled before anyone has
    // asked for it and the count says more was read than was.
    body: new ReadableStream<Uint8Array>({
      pull(controller) {
        const piece = pieces[index];
        if (!piece) {
          controller.close();
          return;
        }
        index += 1;
        controller.enqueue(piece);
      },
    }, { highWaterMark: 0 }),
  };
}

const artifact = {
  filename: "pkg_1.0.0_amd64.deb",
  size: 1234,
  sha256: "a".repeat(64),
  contentType: "application/vnd.debian.binary-package",
  metadata: {},
};

describe("MemoryUploadBroker", () => {
  it("creates a local PUT upload target with content metadata", async () => {
    const broker = new MemoryUploadBroker(new MemoryRepositoryObjectStore());

    await expect(
      broker.createUploadTarget({
        repositoryName: "debian-internal",
        sessionId: "session_123",
        uploadId: "upload_456",
        artifact,
        expiresAt: new Date("2026-07-15T00:00:00.000Z"),
      }),
    ).resolves.toEqual({
      uploadId: "upload_456",
      filename: "pkg_1.0.0_amd64.deb",
      objectKey: "_staging/uploads/debian-internal/session_123/upload_456/pkg_1.0.0_amd64.deb",
      method: "PUT",
      url: "/api/uploads/session_123/upload_456",
      headers: {
        "content-type": "application/vnd.debian.binary-package",
        "x-amz-meta-axis-sha256": "a".repeat(64),
        "x-amz-meta-axis-upload-id": "upload_456",
      },
      expiresAt: "2026-07-15T00:00:00.000Z",
    });
  });

  it("rejects uploads when stored bytes do not match the expected sha256", async () => {
    const objectStore = new MemoryRepositoryObjectStore();
    const broker = new MemoryUploadBroker(objectStore);
    const target = await broker.createUploadTarget({
      repositoryName: "debian-internal",
      sessionId: "session_123",
      uploadId: "upload_456",
      artifact,
      expiresAt: new Date("2026-07-15T00:00:00.000Z"),
    });

    await broker.putUpload({
      target,
      body: arriving(new Uint8Array(1234)),
      contentType: artifact.contentType,
      maxBytes: artifact.size,
    });

    await expect(broker.verifyUpload({ target, expected: artifact })).rejects.toThrow("Uploaded object sha256 mismatch");
  });

  it("stores local uploads and verifies object metadata", async () => {
    const objectStore = new MemoryRepositoryObjectStore();
    const broker = new MemoryUploadBroker(objectStore);
    const body = new Uint8Array([1, 2, 3]);
    const target = await broker.createUploadTarget({
      repositoryName: "debian-internal",
      sessionId: "session_123",
      uploadId: "upload_456",
      artifact: {
        ...artifact,
        size: 3,
        sha256: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
      },
      expiresAt: new Date("2026-07-15T00:00:00.000Z"),
    });

    await broker.putUpload({ target, body: arriving(body), contentType: artifact.contentType, maxBytes: 3 });

    await expect(broker.verifyUpload({
      target,
      expected: {
        ...artifact,
        size: 3,
        sha256: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
      },
    })).resolves.toEqual({
      uploadId: "upload_456",
      objectKey: "_staging/uploads/debian-internal/session_123/upload_456/pkg_1.0.0_amd64.deb",
      size: 3,
      sha256: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
    });
  });

  it("writes an arriving upload in pieces rather than holding it", async () => {
    // The declared size may be gigabytes and a Worker has 128 MB of heap, so
    // gathering the body first would set the real ceiling wherever memory ran
    // out. Each piece reaches storage on its own.
    const objectStore = new MemoryRepositoryObjectStore();
    const createPartWriter = objectStore.createPartWriter.bind(objectStore);
    let writes = 0;
    let heldWholeBody = false;
    objectStore.putBytes = async () => {
      heldWholeBody = true;
    };
    objectStore.createPartWriter = async (key, contentType) => {
      const writer = await createPartWriter(key, contentType);
      return { ...writer, write: async (chunk: Uint8Array) => {
        writes += 1;
        await writer.write(chunk);
      } };
    };
    const broker = new MemoryUploadBroker(objectStore);
    const target = await broker.createUploadTarget({
      repositoryName: "debian-internal",
      sessionId: "session_123",
      uploadId: "upload_456",
      artifact,
      expiresAt: new Date("2026-07-15T00:00:00.000Z"),
    });

    await broker.putUpload({
      target,
      body: inPieces([new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3])]).body,
      contentType: artifact.contentType,
      maxBytes: artifact.size,
    });

    expect(writes).toBe(3);
    expect(heldWholeBody).toBe(false);
    expect(objectStore.objects[0]?.value).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("stops reading an upload as soon as it outgrows the size it declared", async () => {
    // A chunked request declares no length, so this can only be caught while
    // the bytes are arriving -- and catching it there is the point: the rest
    // of the body is never asked for, and what was written before then must
    // not survive as half an artifact.
    const objectStore = new MemoryRepositoryObjectStore();
    const broker = new MemoryUploadBroker(objectStore);
    const target = await broker.createUploadTarget({
      repositoryName: "debian-internal",
      sessionId: "session_123",
      uploadId: "upload_456",
      artifact,
      expiresAt: new Date("2026-07-15T00:00:00.000Z"),
    });
    const arriving = inPieces([new Uint8Array(2), new Uint8Array(2), new Uint8Array(2)]);

    await expect(broker.putUpload({
      target,
      body: arriving.body,
      contentType: artifact.contentType,
      maxBytes: 3,
    })).rejects.toThrow("Uploaded object is larger than the declared artifact size");

    expect(arriving.pulled()).toBe(2);
    expect(objectStore.objects).toHaveLength(0);
  });

  it("hashes a stored object that is served as a stream", async () => {
    // R2 answers with a stream and the memory store with an array, so only one
    // of the two branches of the digest is otherwise reached from these tests.
    const objectStore = new MemoryRepositoryObjectStore();
    const bytes = new Uint8Array([1, 2, 3]);
    const broker = new MemoryUploadBroker(objectStore);
    const expected = {
      ...artifact,
      size: 3,
      sha256: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
    };
    const target = await broker.createUploadTarget({
      repositoryName: "debian-internal",
      sessionId: "session_123",
      uploadId: "upload_456",
      artifact: expected,
      expiresAt: new Date("2026-07-15T00:00:00.000Z"),
    });
    await broker.putUpload({ target, body: arriving(bytes), contentType: artifact.contentType, maxBytes: 3 });
    objectStore.getObject = async () => ({ body: arriving(bytes), contentType: artifact.contentType });

    await expect(broker.verifyUpload({ target, expected })).resolves.toMatchObject({ size: 3 });
  });
});
