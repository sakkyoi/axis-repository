import { describe, expect, it } from "vitest";
import { Pbkdf2PasswordHasher, Sha256SecretHasher, WebCryptoRandomId } from "./crypto";

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

describe("Pbkdf2PasswordHasher", () => {
  // Keep the work factor low so the suite stays fast; production uses the default.
  const hasher = new Pbkdf2PasswordHasher("pepper", 1_000);

  it("salts each password so identical passwords do not collide", async () => {
    const first = await hasher.hash("correct horse battery");
    const second = await hasher.hash("correct horse battery");

    expect(first).not.toBe(second);
    expect(first).toMatch(/^pbkdf2-sha256\$1000\$[^$]+\$[^$]+$/);
    await expect(hasher.verify("correct horse battery", first)).resolves.toBe(true);
    await expect(hasher.verify("correct horse battery", second)).resolves.toBe(true);
    await expect(hasher.verify("wrong", first)).resolves.toBe(false);
  });

  it("still verifies legacy sha256 digests and reports them as needing a rehash", async () => {
    const legacy = await new Sha256SecretHasher("pepper").hash("legacy-password");

    await expect(hasher.verify("legacy-password", legacy)).resolves.toBe(true);
    await expect(hasher.verify("other-password", legacy)).resolves.toBe(false);
    expect(hasher.needsRehash(legacy)).toBe(true);
    expect(hasher.needsRehash(await hasher.hash("legacy-password"))).toBe(false);
  });

  it("treats a hash with a weaker work factor as needing a rehash", async () => {
    const weak = await new Pbkdf2PasswordHasher("pepper", 100).hash("password");

    expect(hasher.needsRehash(weak)).toBe(true);
    // Raising the iteration count must not invalidate existing passwords.
    await expect(hasher.verify("password", weak)).resolves.toBe(true);
  });

  it("keys the derivation with the pepper as well as the salt", async () => {
    const password = "operator-password";
    const stored = await hasher.hash(password);

    // A copy of stored state without TOKEN_HASH_PEPPER must not be crackable,
    // which is the property the previous keyed SHA-256 scheme had.
    await expect(new Pbkdf2PasswordHasher("different-pepper", 1_000).verify(password, stored))
      .resolves.toBe(false);
    await expect(new Pbkdf2PasswordHasher("", 1_000).verify(password, stored)).resolves.toBe(false);
    await expect(new Pbkdf2PasswordHasher("pepper", 1_000).verify(password, stored)).resolves.toBe(true);
  });

  it("rejects malformed stored hashes instead of throwing", async () => {
    for (const malformed of [
      "pbkdf2-sha256$",
      "pbkdf2-sha256$abc$c2FsdA$aGFzaA",
      "pbkdf2-sha256$1000$$",
      "pbkdf2-sha256$1000$!!!not-base64!!!$aGFzaA",
    ]) {
      await expect(hasher.verify("password", malformed)).resolves.toBe(false);
    }
  });
});
