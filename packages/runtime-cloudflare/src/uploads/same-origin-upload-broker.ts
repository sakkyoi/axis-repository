import {
  ValidationError,
  type PublishArtifactRequest,
  type RepositoryObjectStore,
  type UploadedObject,
  type UploadBroker,
  type UploadTarget,
} from "@axis-repository/core";

export class SameOriginUploadBroker implements UploadBroker {
  constructor(private readonly objectStore: RepositoryObjectStore) {}

  async createUploadTarget(input: {
    sessionId: string;
    uploadId: string;
    artifact: PublishArtifactRequest;
    expiresAt: Date;
  }): Promise<UploadTarget> {
    return {
      uploadId: input.uploadId,
      filename: input.artifact.filename,
      objectKey: `_staging/uploads/${input.sessionId}/${input.uploadId}/${input.artifact.filename}`,
      method: "PUT",
      url: `/api/uploads/${input.sessionId}/${input.uploadId}`,
      headers: {
        "content-type": input.artifact.contentType,
        "x-amz-meta-axis-sha256": input.artifact.sha256,
        "x-amz-meta-axis-upload-id": input.uploadId,
      },
      expiresAt: input.expiresAt.toISOString(),
    };
  }

  async putUpload(input: { target: UploadTarget; body: Uint8Array; contentType?: string }): Promise<void> {
    await this.objectStore.putBytes(
      input.target.objectKey,
      input.body,
      input.contentType ?? input.target.headers["content-type"] ?? "application/octet-stream",
    );
  }

  async verifyUpload(input: { target: UploadTarget; expected: PublishArtifactRequest }): Promise<UploadedObject> {
    const metadata = await this.objectStore.headObject(input.target.objectKey);
    if (!metadata) {
      throw new ValidationError(`Uploaded object is missing: ${input.target.objectKey}`);
    }
    if (metadata.contentLength !== input.expected.size) {
      throw new ValidationError(`Uploaded object size mismatch: ${input.target.objectKey}`);
    }
    const object = await this.objectStore.getObject(input.target.objectKey);
    if (!object) {
      throw new ValidationError(`Uploaded object is missing: ${input.target.objectKey}`);
    }
    if (await sha256Hex(object.body) !== input.expected.sha256) {
      throw new ValidationError(`Uploaded object sha256 mismatch: ${input.target.objectKey}`);
    }

    return {
      uploadId: input.target.uploadId,
      objectKey: input.target.objectKey,
      size: input.expected.size,
      sha256: input.expected.sha256,
    };
  }

  async abortUpload(): Promise<void> {}
}

async function sha256Hex(body: string | Uint8Array | ReadableStream): Promise<string> {
  const bytes = await bodyBytes(body);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function bodyBytes(body: string | Uint8Array | ReadableStream): Promise<Uint8Array> {
  if (typeof body === "string") {
    return new TextEncoder().encode(body);
  }
  if (body instanceof Uint8Array) {
    return body;
  }
  return new Uint8Array(await new Response(body).arrayBuffer());
}

export default SameOriginUploadBroker;
