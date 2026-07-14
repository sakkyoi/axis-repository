import { ValidationError, type PublishArtifactRequest, type UploadedObject, type UploadBroker, type UploadTarget } from "@axis-repository/core";
import { AwsClient } from "aws4fetch";

export interface R2ObjectLike {
  size: number;
  customMetadata?: Record<string, string>;
}

export interface R2BucketLike {
  head(key: string): Promise<R2ObjectLike | null>;
}

export interface R2PresignedUploadBrokerOptions {
  bucket: R2BucketLike;
  accountId: string;
  bucketName: string;
  accessKeyId: string;
  secretAccessKey: string;
  uploadUrlTtlSeconds?: number;
  now?: () => Date;
}

export class R2PresignedUploadBroker implements UploadBroker {
  private readonly bucket: R2BucketLike;
  private readonly accountId: string;
  private readonly bucketName: string;
  private readonly uploadUrlTtlSeconds: number | undefined;
  private readonly now: () => Date;
  private readonly aws: AwsClient;

  constructor(options: R2PresignedUploadBrokerOptions) {
    this.bucket = options.bucket;
    this.accountId = options.accountId;
    this.bucketName = options.bucketName;
    this.uploadUrlTtlSeconds = options.uploadUrlTtlSeconds;
    this.now = options.now ?? (() => new Date());
    this.aws = new AwsClient({
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
      service: "s3",
      region: "auto",
    });
  }

  async createUploadTarget(input: {
    sessionId: string;
    uploadId: string;
    artifact: PublishArtifactRequest;
    expiresAt: Date;
  }): Promise<UploadTarget> {
    const now = this.now();
    const ttlSeconds = this.getUploadTtlSeconds(now, input.expiresAt);
    const effectiveExpiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    const objectKey = `_staging/uploads/${input.sessionId}/${input.uploadId}/${input.artifact.filename}`;
    const headers = {
      "content-type": input.artifact.contentType,
      "x-amz-meta-axis-sha256": input.artifact.sha256,
      "x-amz-meta-axis-upload-id": input.uploadId,
    };
    const url = new URL(`https://${this.accountId}.r2.cloudflarestorage.com/${this.bucketName}/${objectKey}`);
    url.searchParams.set("X-Amz-Expires", String(ttlSeconds));

    const signed = await this.aws.sign(url, {
      method: "PUT",
      headers,
      aws: {
        datetime: toAwsDatetime(now),
        signQuery: true,
        allHeaders: true,
      },
    });

    return {
      uploadId: input.uploadId,
      filename: input.artifact.filename,
      objectKey,
      method: "PUT",
      url: signed.url,
      headers,
      expiresAt: effectiveExpiresAt.toISOString(),
    };
  }

  async verifyUpload(input: { target: UploadTarget; expected: PublishArtifactRequest }): Promise<UploadedObject> {
    const object = await this.bucket.head(input.target.objectKey);
    if (!object) {
      throw new ValidationError(`Uploaded object is missing: ${input.target.objectKey}`);
    }
    if (object.size !== input.expected.size) {
      throw new ValidationError(`Uploaded object size mismatch: ${input.target.objectKey}`);
    }
    if (object.customMetadata?.["axis-sha256"] !== input.expected.sha256) {
      throw new ValidationError(`Uploaded object sha256 metadata mismatch: ${input.target.objectKey}`);
    }
    if (object.customMetadata?.["axis-upload-id"] !== input.target.uploadId) {
      throw new ValidationError(`Uploaded object upload id metadata mismatch: ${input.target.objectKey}`);
    }

    return {
      uploadId: input.target.uploadId,
      objectKey: input.target.objectKey,
      size: object.size,
      sha256: input.expected.sha256,
    };
  }

  async abortUpload(): Promise<void> {}

  private getUploadTtlSeconds(now: Date, sessionExpiresAt: Date): number {
    const remainingSeconds = Math.max(0, Math.floor((sessionExpiresAt.getTime() - now.getTime()) / 1000));
    if (this.uploadUrlTtlSeconds === undefined) {
      return remainingSeconds;
    }
    return Math.min(remainingSeconds, this.uploadUrlTtlSeconds);
  }
}

function toAwsDatetime(date: Date): string {
  return date.toISOString().replaceAll("-", "").replaceAll(":", "").replace(/\.\d{3}Z$/, "Z");
}
