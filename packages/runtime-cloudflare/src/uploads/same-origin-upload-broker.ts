import {
  ValidationError,
  type PublishArtifactRequest,
  type RepositoryObjectStore,
  type UploadedObject,
  type UploadBroker,
  type UploadTarget,
} from "@axis-repository/core";
import { digestStreamHex } from "../storage/digest";

/**
 * Staging keys include the repository so a repository-scoped object store can
 * allow reads of its own in-flight uploads without exposing everyone else's.
 */
export function stagingObjectKey(input: {
  repositoryName: string;
  sessionId: string;
  uploadId: string;
  artifact: { filename: string };
}): string {
  return `_staging/uploads/${input.repositoryName}/${input.sessionId}/${input.uploadId}/${input.artifact.filename}`;
}

export class SameOriginUploadBroker implements UploadBroker {
  constructor(private readonly objectStore: RepositoryObjectStore) {}

  async createUploadTarget(input: {
    repositoryName: string;
    sessionId: string;
    uploadId: string;
    artifact: PublishArtifactRequest;
    expiresAt: Date;
  }): Promise<UploadTarget> {
    return {
      uploadId: input.uploadId,
      filename: input.artifact.filename,
      objectKey: stagingObjectKey(input),
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

  /**
   * Takes an upload the Worker is relaying itself.
   *
   * The bytes go to storage as they arrive rather than being gathered first.
   * A declared artifact size may be gigabytes and a Worker has 128 MB of heap,
   * so anything that holds the whole body decides the real ceiling by running
   * out of memory -- and does it at whatever size the heap happens to give out
   * at, which is neither a number anyone chose nor an error anyone can read.
   *
   * `maxBytes` is counted as the stream is consumed, not checked against what
   * the request declared: a chunked request declares nothing, so a body that
   * kept arriving would otherwise be written in full before anything objected.
   * Exceeding it abandons the write, which leaves no object behind.
   */
  async putUpload(input: {
    target: UploadTarget;
    body: ReadableStream<Uint8Array> | null;
    contentType?: string;
    maxBytes: number;
  }): Promise<void> {
    const contentType = input.contentType
      ?? input.target.headers["content-type"]
      ?? "application/octet-stream";
    if (!input.body) {
      await this.objectStore.putBytes(input.target.objectKey, new Uint8Array(0), contentType);
      return;
    }

    const writer = await this.objectStore.createPartWriter(input.target.objectKey, contentType);
    const reader = input.body.getReader();
    let received = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) {
          break;
        }
        received += next.value.byteLength;
        if (received > input.maxBytes) {
          throw new ValidationError("Uploaded object is larger than the declared artifact size");
        }
        await writer.write(next.value);
      }
      await writer.complete();
    } catch (error) {
      await writer.abort().catch(() => undefined);
      throw error;
    }
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

}

/**
 * Hashes a stored object without holding it.
 *
 * A store that answers with a stream is read as one -- reading it into an
 * array first would put the whole artifact back in memory, which is what
 * storing it in parts was for. A store that answers with bytes has already
 * spent that memory and nothing is saved by pretending otherwise.
 */
async function sha256Hex(body: string | Uint8Array | ReadableStream): Promise<string> {
  if (body instanceof ReadableStream) {
    return digestStreamHex("SHA-256", body as ReadableStream<Uint8Array>);
  }
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export default SameOriginUploadBroker;
