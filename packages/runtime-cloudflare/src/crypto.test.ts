import { describe, expect, it } from "vitest";
import { Sha256SecretHasher, WebCryptoRandomId } from "./crypto";

describe("runtime crypto helpers", () => {
  it("hashes and verifies secrets", async () => {
    const hasher = new Sha256SecretHasher("pepper");

    const hash = await hasher.hash("axis_publish_secret");

    expect(hash).toMatch(/^sha256:/);
    await expect(hasher.verify("axis_publish_secret", hash)).resolves.toBe(true);
    await expect(hasher.verify("wrong", hash)).resolves.toBe(false);
  });

  it("creates prefixed ids", () => {
    const ids = new WebCryptoRandomId();

    expect(ids.create("repo")).toMatch(/^repo_[a-f0-9]{32}$/);
  });
});
