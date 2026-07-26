import { describe, expect, it } from "vitest";
import { MemoryUploadBroker } from "./memory-upload-broker";
import { MemoryRepositoryObjectStore } from "../storage/repository-object-store";

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

    await broker.putUpload({ target, body: new Uint8Array(1234), contentType: artifact.contentType });

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

    await broker.putUpload({ target, body, contentType: artifact.contentType });

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
});
