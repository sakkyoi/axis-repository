import { describe, expect, it } from "vitest";
import { DEFAULT_DOWNLOAD_URL_TTL_SECONDS, R2PresignedDownloadSigner } from "./object-download-url";

function createSigner(ttlSeconds?: number) {
  return new R2PresignedDownloadSigner({
    accountId: "account123",
    bucketName: "axis-repository",
    accessKeyId: "access",
    secretAccessKey: "secret",
    now: () => new Date("2026-07-14T00:00:00.000Z"),
    ...(ttlSeconds === undefined ? {} : { ttlSeconds }),
  });
}

describe("R2PresignedDownloadSigner", () => {
  it("signs a GET the bucket will answer", async () => {
    const signer = createSigner();

    const url = new URL(await signer.sign("repositories/debian-internal/dists/noble/InRelease"));

    expect(url.origin).toBe("https://account123.r2.cloudflarestorage.com");
    expect(url.pathname).toBe("/axis-repository/repositories/debian-internal/dists/noble/InRelease");
    expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(url.searchParams.get("X-Amz-Expires")).toBe(String(DEFAULT_DOWNLOAD_URL_TTL_SECONDS));
    expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy();
  });

  it("encodes a key that would otherwise read as part of the URL", async () => {
    // A published filename is publisher-controlled. One carrying `?` or `#`
    // would sign a path that stops before the rest of the key, and the
    // signature would then cover an object nobody asked for.
    const signer = createSigner();

    const url = new URL(await signer.sign("repositories/py/packages/demo/my demo?x#y.tar.gz"));

    expect(url.search).toContain("X-Amz-Signature");
    expect(url.searchParams.has("x")).toBe(false);
    expect(url.hash).toBe("");
    expect(url.pathname).toContain("my%20demo%3Fx%23y.tar.gz");
  });

  it("reports the window it signed, so a caller can bound its caching", async () => {
    const signer = createSigner(60);

    expect(signer.ttlSeconds).toBe(60);
    expect(new URL(await signer.sign("repositories/py/simple/index.html")).searchParams.get("X-Amz-Expires"))
      .toBe("60");
  });
});
