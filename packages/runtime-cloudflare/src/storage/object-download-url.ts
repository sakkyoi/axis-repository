import { AwsClient } from "aws4fetch";

/**
 * Signs a URL a client can fetch a stored object from directly.
 *
 * Every request this Worker answers is routed through one Durable Object, so
 * serving an artifact meant streaming it through that object — billed for as
 * long as it took, and a single point every download in the deployment passes
 * through. Handing back a signed URL keeps the request (which resolves the
 * path and decides who may read it) and gives up the bytes.
 *
 * Signing is per-request rather than a stable public URL, so it works the same
 * for a private repository as a public one, and needs nothing of the bucket
 * beyond the credentials that already sign uploads.
 */
export interface RepositoryObjectDownloadSigner {
  /** How long a signed URL stays usable, so callers can bound their caching. */
  readonly ttlSeconds: number;
  sign(objectKey: string): Promise<string>;
}

/**
 * Short enough that a leaked URL is a small window, long enough to survive a
 * slow client resolving and starting the download.
 */
export const DEFAULT_DOWNLOAD_URL_TTL_SECONDS = 300;

export class R2PresignedDownloadSigner implements RepositoryObjectDownloadSigner {
  readonly ttlSeconds: number;
  private readonly accountId: string;
  private readonly bucketName: string;
  private readonly aws: AwsClient;
  private readonly now: () => Date;

  constructor(options: {
    accountId: string;
    bucketName: string;
    accessKeyId: string;
    secretAccessKey: string;
    ttlSeconds?: number;
    now?: () => Date;
  }) {
    this.accountId = options.accountId;
    this.bucketName = options.bucketName;
    this.ttlSeconds = options.ttlSeconds ?? DEFAULT_DOWNLOAD_URL_TTL_SECONDS;
    this.now = options.now ?? (() => new Date());
    this.aws = new AwsClient({
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
      service: "s3",
      region: "auto",
    });
  }

  async sign(objectKey: string): Promise<string> {
    // Each segment is encoded on its own: a key may contain characters that
    // would otherwise read as a path boundary or start a query.
    const signedPath = [this.bucketName, ...objectKey.split("/")]
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    const url = new URL(`https://${this.accountId}.r2.cloudflarestorage.com/${signedPath}`);
    url.searchParams.set("X-Amz-Expires", String(this.ttlSeconds));

    const signed = await this.aws.sign(url, {
      method: "GET",
      aws: {
        datetime: toAwsDatetime(this.now()),
        signQuery: true,
      },
    });
    return signed.url;
  }
}

function toAwsDatetime(date: Date): string {
  return date.toISOString().replaceAll("-", "").replaceAll(":", "").replace(/\.\d{3}Z$/, "Z");
}
