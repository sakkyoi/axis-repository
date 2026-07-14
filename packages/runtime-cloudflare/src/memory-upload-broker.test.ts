import { describe, expect, it } from "vitest";
import { MemoryUploadBroker } from "./memory-upload-broker";

const artifact = {
  filename: "pkg_1.0.0_amd64.deb",
  size: 1234,
  sha256: "a".repeat(64),
  contentType: "application/vnd.debian.binary-package",
  metadata: {},
};

describe("MemoryUploadBroker", () => {
  it("creates a local PUT upload target with content metadata", async () => {
    const broker = new MemoryUploadBroker();

    await expect(
      broker.createUploadTarget({
        sessionId: "session_123",
        uploadId: "upload_456",
        artifact,
        expiresAt: new Date("2026-07-15T00:00:00.000Z"),
      }),
    ).resolves.toEqual({
      uploadId: "upload_456",
      filename: "pkg_1.0.0_amd64.deb",
      objectKey: "_staging/uploads/session_123/upload_456/pkg_1.0.0_amd64.deb",
      method: "PUT",
      url: "https://uploads.local/session_123/upload_456",
      headers: {
        "content-type": "application/vnd.debian.binary-package",
        "x-amz-meta-axis-sha256": "a".repeat(64),
        "x-amz-meta-axis-upload-id": "upload_456",
      },
      expiresAt: "2026-07-15T00:00:00.000Z",
    });
  });

  it("verifies uploads from the expected artifact metadata without reading bytes", async () => {
    const broker = new MemoryUploadBroker();
    const target = await broker.createUploadTarget({
      sessionId: "session_123",
      uploadId: "upload_456",
      artifact,
      expiresAt: new Date("2026-07-15T00:00:00.000Z"),
    });

    await expect(broker.verifyUpload({ target, expected: artifact })).resolves.toEqual({
      uploadId: "upload_456",
      objectKey: "_staging/uploads/session_123/upload_456/pkg_1.0.0_amd64.deb",
      size: 1234,
      sha256: "a".repeat(64),
    });
  });
});
