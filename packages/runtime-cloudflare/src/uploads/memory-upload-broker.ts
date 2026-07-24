import type { PublishArtifactRequest, UploadedObject, UploadBroker, UploadTarget } from "@axis-repository/core";

export class MemoryUploadBroker implements UploadBroker {
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
      url: `https://uploads.local/${input.sessionId}/${input.uploadId}`,
      headers: {
        "content-type": input.artifact.contentType,
        "x-amz-meta-axis-sha256": input.artifact.sha256,
        "x-amz-meta-axis-upload-id": input.uploadId,
      },
      expiresAt: input.expiresAt.toISOString(),
    };
  }

  async verifyUpload(input: { target: UploadTarget; expected: PublishArtifactRequest }): Promise<UploadedObject> {
    return {
      uploadId: input.target.uploadId,
      objectKey: input.target.objectKey,
      size: input.expected.size,
      sha256: input.expected.sha256,
    };
  }

  async abortUpload(): Promise<void> {}
}

export default MemoryUploadBroker;
