import { ValidationError, type PublishArtifactRequest, type UploadedObject, type UploadBroker, type UploadTarget } from "@axis-repository/core";
import { AwsClient } from "aws4fetch";
import { stagingObjectKey } from "./same-origin-upload-broker";
import { digestStreamHex } from "../storage/digest";

export interface R2ObjectLike {
  size: number;
  customMetadata?: Record<string, string>;
}

export interface R2ObjectBodyLike extends R2ObjectLike {
  body: ReadableStream<Uint8Array> | null;
}

export interface R2BucketLike {
  head(key: string): Promise<R2ObjectLike | null>;
  get(key: string): Promise<R2ObjectBodyLike | null>;
}

export interface R2PresignedUploadBrokerOptions {
  bucket: R2BucketLike;
  accountId: string;
  bucketName: string;
  accessKeyId: string;
  secretAccessKey: string;
  uploadUrlTtlSeconds?: number;
  now?: () => Date;
  /** Used to ask the bucket the signed URLs address whether it holds an object. */
  fetchImpl?: typeof fetch;
}

export class R2PresignedUploadBroker implements UploadBroker {
  private readonly bucket: R2BucketLike;
  private readonly accountId: string;
  private readonly bucketName: string;
  private readonly uploadUrlTtlSeconds: number | undefined;
  private readonly now: () => Date;
  private readonly aws: AwsClient;
  private readonly fetchImpl: typeof fetch;

  constructor(options: R2PresignedUploadBrokerOptions) {
    this.bucket = options.bucket;
    this.accountId = options.accountId;
    this.bucketName = options.bucketName;
    this.uploadUrlTtlSeconds = options.uploadUrlTtlSeconds;
    this.now = options.now ?? (() => new Date());
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.aws = new AwsClient({
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
      service: "s3",
      region: "auto",
    });
  }

  async createUploadTarget(input: {
    repositoryName: string;
    sessionId: string;
    uploadId: string;
    artifact: PublishArtifactRequest;
    expiresAt: Date;
  }): Promise<UploadTarget> {
    const now = this.now();
    if (input.expiresAt.getTime() <= now.getTime()) {
      throw new ValidationError("Upload target expiry has passed");
    }
    const ttlSeconds = this.getUploadTtlSeconds(now, input.expiresAt);
    const effectiveExpiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    const objectKey = stagingObjectKey(input);
    const signedPath = [
      this.bucketName,
      "_staging",
      "uploads",
      input.repositoryName,
      input.sessionId,
      input.uploadId,
      input.artifact.filename,
    ]
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    const headers = {
      "content-type": input.artifact.contentType,
      "x-amz-meta-axis-sha256": input.artifact.sha256,
      "x-amz-meta-axis-upload-id": input.uploadId,
    };
    const url = new URL(`https://${this.accountId}.r2.cloudflarestorage.com/${signedPath}`);
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
      throw new ValidationError(await this.missingObjectMessage(input.target.objectKey));
    }
    if (object.size !== input.expected.size) {
      throw new ValidationError(`Uploaded object size mismatch: ${input.target.objectKey}`);
    }
    // The digest and upload id signed into the upload URL are stored as
    // metadata, and were once checked here. Hashing the bytes says the same
    // thing and more, and unlike the metadata it holds however the object got
    // there: a protocol upload the Worker received and copied into place
    // carries no metadata from a PUT that never happened, and was refused.
    await this.requireStoredBytesMatch(input.target.objectKey, input.expected.sha256);

    return {
      uploadId: input.target.uploadId,
      objectKey: input.target.objectKey,
      size: object.size,
      sha256: input.expected.sha256,
    };
  }

  /**
   * Hashes what was stored, rather than trusting what the upload said.
   *
   * The metadata carrying the digest is signed into the upload URL, so it
   * cannot be altered — but nothing binds it to the bytes. R2 validates no
   * full-object SHA-256 on PutObject, so whoever holds the URL can write any
   * body of the declared length and it would be published under a digest it
   * does not have. A client checking the digest then refuses the download; one
   * that does not check installs whatever arrived.
   *
   * This is the one point where a presigned upload's bytes pass through the
   * Worker. They are read from R2 rather than over the network and hashed as
   * they stream, so it costs a read and holds nothing.
   */
  /**
   * Explains an object the binding cannot find.
   *
   * Two buckets are in play and nothing makes them agree: the binding the
   * Worker reads through, and the name `R2_BUCKET_NAME` gives, which is what
   * signed URLs address. A binding does not report the bucket it points at, so
   * a mismatch cannot be caught when it is configured — only here, where an
   * upload that plainly succeeded is nowhere to be found.
   *
   * Asking the signed side settles which it is. Finding the object there means
   * the two names differ, and saying so is the difference between fixing one
   * line and searching for an upload that was never lost. Failing to ask
   * changes nothing about what went wrong, so it falls back to the plain
   * account of it.
   */
  private async missingObjectMessage(objectKey: string): Promise<string> {
    const missing = `Uploaded object is missing: ${objectKey}`;
    try {
      if (!await this.signedBucketHasObject(objectKey)) {
        return missing;
      }
    } catch {
      return missing;
    }
    return `${missing}. It is in ${this.bucketName}, which R2_BUCKET_NAME names,`
      + " but not in the bucket AXIS_OBJECTS is bound to. Both have to name the"
      + " same bucket: uploads and downloads address the first, and everything"
      + " else reads through the second.";
  }

  private async signedBucketHasObject(objectKey: string): Promise<boolean> {
    const signedPath = [this.bucketName, ...objectKey.split("/")]
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    const url = new URL(`https://${this.accountId}.r2.cloudflarestorage.com/${signedPath}`);
    url.searchParams.set("X-Amz-Expires", "60");
    const signed = await this.aws.sign(url, {
      method: "HEAD",
      aws: { datetime: toAwsDatetime(this.now()), signQuery: true },
    });
    return (await this.fetchImpl(signed.url, { method: "HEAD" })).ok;
  }

  private async requireStoredBytesMatch(objectKey: string, expectedSha256: string): Promise<void> {
    const stored = await this.bucket.get(objectKey);
    if (!stored?.body) {
      throw new ValidationError(`Uploaded object is missing: ${objectKey}`);
    }
    if (await digestStreamHex("SHA-256", stored.body) !== expectedSha256) {
      throw new ValidationError(`Uploaded object sha256 mismatch: ${objectKey}`);
    }
  }


  private getUploadTtlSeconds(now: Date, sessionExpiresAt: Date): number {
    const remainingSeconds = Math.max(0, Math.floor((sessionExpiresAt.getTime() - now.getTime()) / 1000));
    if (remainingSeconds < 1) {
      throw new ValidationError("Upload target expiry has passed");
    }
    if (this.uploadUrlTtlSeconds === undefined) {
      return remainingSeconds;
    }
    if (
      !Number.isFinite(this.uploadUrlTtlSeconds) ||
      !Number.isInteger(this.uploadUrlTtlSeconds) ||
      this.uploadUrlTtlSeconds <= 0
    ) {
      throw new ValidationError("UPLOAD_URL_TTL_SECONDS must be a positive integer");
    }
    return Math.min(remainingSeconds, this.uploadUrlTtlSeconds);
  }
}

function toAwsDatetime(date: Date): string {
  return date.toISOString().replaceAll("-", "").replaceAll(":", "").replace(/\.\d{3}Z$/, "Z");
}
