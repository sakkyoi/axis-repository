import { describe, expect, it } from "vitest";
import { ValidationError } from "@axis-repository/core";
import { R2PresignedUploadBroker, type R2BucketLike } from "./r2-upload-broker";

const artifact = {
  filename: "myapp_1.2.3_amd64.deb",
  size: 1234,
  sha256: "a".repeat(64),
  contentType: "application/vnd.debian.binary-package",
  metadata: {},
};

class FakeR2Bucket implements R2BucketLike {
  objects = new Map<string, { size: number; customMetadata: Record<string, string> }>();

  async head(key: string) {
    return this.objects.get(key) ?? null;
  }
}

function createBroker(bucket = new FakeR2Bucket()) {
  return {
    bucket,
    broker: new R2PresignedUploadBroker({
      bucket,
      accountId: "account123",
      bucketName: "axis-repository",
      accessKeyId: "access",
      secretAccessKey: "secret",
      now: () => new Date("2026-07-14T00:00:00.000Z"),
    }),
  };
}

describe("R2PresignedUploadBroker", () => {
  it("creates a signed R2 PUT upload target with content metadata", async () => {
    const { broker } = createBroker();

    const target = await broker.createUploadTarget({
      sessionId: "pub_1",
      uploadId: "upl_1",
      artifact,
      expiresAt: new Date("2026-07-14T00:15:00.000Z"),
    });

    expect(target).toMatchObject({
      uploadId: "upl_1",
      filename: "myapp_1.2.3_amd64.deb",
      objectKey: "_staging/uploads/pub_1/upl_1/myapp_1.2.3_amd64.deb",
      method: "PUT",
      headers: {
        "content-type": "application/vnd.debian.binary-package",
        "x-amz-meta-axis-sha256": "a".repeat(64),
        "x-amz-meta-axis-upload-id": "upl_1",
      },
      expiresAt: "2026-07-14T00:15:00.000Z",
    });
    const url = new URL(target.url);
    expect(url.origin).toBe("https://account123.r2.cloudflarestorage.com");
    expect(url.pathname).toBe("/axis-repository/_staging/uploads/pub_1/upl_1/myapp_1.2.3_amd64.deb");
    expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("content-type");
  });

  it("caps signed URL expiry with configured ttl", async () => {
    const bucket = new FakeR2Bucket();
    const broker = new R2PresignedUploadBroker({
      bucket,
      accountId: "account123",
      bucketName: "axis-repository",
      accessKeyId: "access",
      secretAccessKey: "secret",
      uploadUrlTtlSeconds: 60,
      now: () => new Date("2026-07-14T00:00:00.000Z"),
    });

    const target = await broker.createUploadTarget({
      sessionId: "pub_1",
      uploadId: "upl_1",
      artifact,
      expiresAt: new Date("2026-07-14T00:15:00.000Z"),
    });

    expect(new URL(target.url).searchParams.get("X-Amz-Expires")).toBe("60");
    expect(target.expiresAt).toBe("2026-07-14T00:01:00.000Z");
  });

  it("rejects expired upload target expiry before signing", async () => {
    const { broker } = createBroker();

    await expect(
      broker.createUploadTarget({
        sessionId: "pub_1",
        uploadId: "upl_1",
        artifact,
        expiresAt: new Date("2026-07-14T00:00:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("verifies an uploaded R2 object", async () => {
    const { bucket, broker } = createBroker();
    bucket.objects.set("_staging/uploads/pub_1/upl_1/myapp_1.2.3_amd64.deb", {
      size: 1234,
      customMetadata: {
        "axis-sha256": "a".repeat(64),
        "axis-upload-id": "upl_1",
      },
    });

    await expect(
      broker.verifyUpload({
        target: {
          uploadId: "upl_1",
          filename: artifact.filename,
          objectKey: "_staging/uploads/pub_1/upl_1/myapp_1.2.3_amd64.deb",
          method: "PUT",
          url: "https://example",
          headers: {},
          expiresAt: "2026-07-14T00:15:00.000Z",
        },
        expected: artifact,
      }),
    ).resolves.toEqual({
      uploadId: "upl_1",
      objectKey: "_staging/uploads/pub_1/upl_1/myapp_1.2.3_amd64.deb",
      size: 1234,
      sha256: "a".repeat(64),
    });
  });

  it("rejects missing uploaded objects", async () => {
    const { broker } = createBroker();

    await expect(
      broker.verifyUpload({
        target: {
          uploadId: "upl_1",
          filename: artifact.filename,
          objectKey: "_staging/uploads/pub_1/upl_1/myapp_1.2.3_amd64.deb",
          method: "PUT",
          url: "https://example",
          headers: {},
          expiresAt: "2026-07-14T00:15:00.000Z",
        },
        expected: artifact,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects size or metadata mismatches", async () => {
    const { bucket, broker } = createBroker();
    const target = {
      uploadId: "upl_1",
      filename: artifact.filename,
      objectKey: "_staging/uploads/pub_1/upl_1/myapp_1.2.3_amd64.deb",
      method: "PUT" as const,
      url: "https://example",
      headers: {},
      expiresAt: "2026-07-14T00:15:00.000Z",
    };

    bucket.objects.set(target.objectKey, {
      size: 999,
      customMetadata: {
        "axis-sha256": "a".repeat(64),
        "axis-upload-id": "upl_1",
      },
    });
    await expect(broker.verifyUpload({ target, expected: artifact })).rejects.toBeInstanceOf(ValidationError);

    bucket.objects.set(target.objectKey, {
      size: 1234,
      customMetadata: {
        "axis-sha256": "b".repeat(64),
        "axis-upload-id": "upl_1",
      },
    });
    await expect(broker.verifyUpload({ target, expected: artifact })).rejects.toBeInstanceOf(ValidationError);

    bucket.objects.set(target.objectKey, {
      size: 1234,
      customMetadata: {
        "axis-sha256": "a".repeat(64),
        "axis-upload-id": "other",
      },
    });
    await expect(broker.verifyUpload({ target, expected: artifact })).rejects.toBeInstanceOf(ValidationError);
  });
});
