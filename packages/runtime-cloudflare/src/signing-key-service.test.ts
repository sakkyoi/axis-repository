import { describe, expect, it } from "vitest";
import { generateKey } from "openpgp";
import { MemoryStateStore, NotFoundError, ValidationError, type Clock, type RandomId } from "@axis-repository/core";
import { SecretEncryption } from "./secret-encryption";
import { SigningKeyService } from "./signing-key-service";

const clock: Clock = { now: () => new Date("2026-07-18T00:00:00.000Z") };
const randomId: RandomId = { create: (prefix) => `${prefix}_fixed` };
const privateFieldNames = ["encryptedPrivateKeyArmored", "encryptedPassphrase", "privateKeyArmored", "passphrase"];

async function privateKeyFixture(passphrase = "correct-passphrase") {
  return generateKey({
    type: "ecc",
    curve: "curve25519Legacy",
    userIDs: [{ name: "Axis Test", email: "axis@example.test" }],
    passphrase,
  });
}

describe("SigningKeyService", () => {
  it("creates encrypted signing keys and returns only public fields", async () => {
    const state = new MemoryStateStore();
    const fixture = await privateKeyFixture();
    const service = new SigningKeyService({
      state,
      clock,
      randomId,
      encryption: new SecretEncryption("local-test-secret"),
    });

    const created = await service.create({
      name: "debian-prod",
      privateKeyArmored: fixture.privateKey,
      passphrase: "correct-passphrase",
    });

    expect(created).toMatchObject({
      id: "signing_key_fixed",
      name: "debian-prod",
      publicKeyArmored: expect.stringContaining("BEGIN PGP PUBLIC KEY BLOCK"),
      fingerprint: expect.any(String),
      keyId: expect.any(String),
      createdAt: "2026-07-18T00:00:00.000Z",
      revokedAt: null,
    });
    expect(created).not.toHaveProperty("encryptedPrivateKeyArmored");
    expect(created).not.toHaveProperty("encryptedPassphrase");
    expect(created).not.toHaveProperty("privateKeyArmored");
    expect(created).not.toHaveProperty("passphrase");

    const stored = await state.signingKeys.getByName("debian-prod");
    expect(stored?.encryptedPrivateKeyArmored.ciphertext).not.toContain("BEGIN PGP PRIVATE KEY");
    expect(stored?.encryptedPassphrase.ciphertext).not.toContain("correct-passphrase");
    expect(JSON.stringify(stored)).not.toContain(fixture.privateKey);
    expect(JSON.stringify(stored)).not.toContain("correct-passphrase");
  });

  it("rejects duplicate signing key names", async () => {
    const fixture = await privateKeyFixture();
    const service = new SigningKeyService({
      state: new MemoryStateStore(),
      clock,
      randomId,
      encryption: new SecretEncryption("local-test-secret"),
    });
    await service.create({
      name: "debian-prod",
      privateKeyArmored: fixture.privateKey,
      passphrase: "correct-passphrase",
    });

    await expect(
      service.create({
        name: "debian-prod",
        privateKeyArmored: fixture.privateKey,
        passphrase: "correct-passphrase",
      }),
    ).rejects.toThrow("Signing key already exists: debian-prod");
  });

  it("rejects duplicate key material by fingerprint even under a different name", async () => {
    const fixture = await privateKeyFixture();
    const service = new SigningKeyService({
      state: new MemoryStateStore(),
      clock,
      randomId,
      encryption: new SecretEncryption("local-test-secret"),
    });
    const created = await service.create({
      name: "debian-prod",
      privateKeyArmored: fixture.privateKey,
      passphrase: "correct-passphrase",
    });

    await expect(
      service.create({
        name: "debian-staging",
        privateKeyArmored: fixture.privateKey,
        passphrase: "correct-passphrase",
      }),
    ).rejects.toThrow(`Signing key already exists with fingerprint: ${created.fingerprint}`);
  });

  it("rejects invalid private keys and wrong passphrases", async () => {
    const fixture = await privateKeyFixture();
    const service = new SigningKeyService({
      state: new MemoryStateStore(),
      clock,
      randomId,
      encryption: new SecretEncryption("local-test-secret"),
    });

    await expect(
      service.create({
        name: "invalid",
        privateKeyArmored: "not a private key",
        passphrase: "correct-passphrase",
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      service.create({
        name: "wrong-passphrase",
        privateKeyArmored: fixture.privateKey,
        passphrase: "wrong-passphrase",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("lists public signing keys and revokes active keys", async () => {
    const state = new MemoryStateStore();
    const fixture = await privateKeyFixture();
    const service = new SigningKeyService({
      state,
      clock,
      randomId,
      encryption: new SecretEncryption("local-test-secret"),
    });
    await service.create({
      name: "debian-prod",
      privateKeyArmored: fixture.privateKey,
      passphrase: "correct-passphrase",
    });

    await expect(service.list()).resolves.toMatchObject([{ name: "debian-prod", revokedAt: null }]);
    const revoked = await service.revoke("signing_key_fixed");
    expect(revoked.revokedAt).toBe("2026-07-18T00:00:00.000Z");
    await expect(service.getActivePrivateKey("signing_key_fixed")).rejects.toThrow("Signing key has been revoked");
  });

  it("preserves the original revocation timestamp when revoke is repeated", async () => {
    let now = "2026-07-18T00:00:00.000Z";
    const mutableClock: Clock = { now: () => new Date(now) };
    const fixture = await privateKeyFixture();
    const service = new SigningKeyService({
      state: new MemoryStateStore(),
      clock: mutableClock,
      randomId,
      encryption: new SecretEncryption("local-test-secret"),
    });
    await service.create({
      name: "debian-prod",
      privateKeyArmored: fixture.privateKey,
      passphrase: "correct-passphrase",
    });

    const firstRevoked = await service.revoke("signing_key_fixed");
    now = "2026-07-19T00:00:00.000Z";
    const secondRevoked = await service.revoke("signing_key_fixed");

    expect(firstRevoked.revokedAt).toBe("2026-07-18T00:00:00.000Z");
    expect(secondRevoked.revokedAt).toBe("2026-07-18T00:00:00.000Z");
  });

  it("does not expose private fields in list and revoke responses", async () => {
    const fixture = await privateKeyFixture();
    const service = new SigningKeyService({
      state: new MemoryStateStore(),
      clock,
      randomId,
      encryption: new SecretEncryption("local-test-secret"),
    });
    await service.create({
      name: "debian-prod",
      privateKeyArmored: fixture.privateKey,
      passphrase: "correct-passphrase",
    });

    const listed = await service.list();
    const revoked = await service.revoke("signing_key_fixed");

    for (const fieldName of privateFieldNames) {
      expect(listed[0]).not.toHaveProperty(fieldName);
      expect(revoked).not.toHaveProperty(fieldName);
    }
  });

  it("throws not found for missing signing keys", async () => {
    const service = new SigningKeyService({
      state: new MemoryStateStore(),
      clock,
      randomId,
      encryption: new SecretEncryption("local-test-secret"),
    });

    await expect(service.revoke("missing")).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.getActivePrivateKey("missing")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("decrypts active private key material for signing", async () => {
    const fixture = await privateKeyFixture();
    const service = new SigningKeyService({
      state: new MemoryStateStore(),
      clock,
      randomId,
      encryption: new SecretEncryption("local-test-secret"),
    });
    await service.create({
      name: "debian-prod",
      privateKeyArmored: fixture.privateKey,
      passphrase: "correct-passphrase",
    });

    await expect(service.getActivePrivateKey("signing_key_fixed")).resolves.toMatchObject({
      privateKeyArmored: expect.stringContaining("BEGIN PGP PRIVATE KEY BLOCK"),
      passphrase: "correct-passphrase",
      fingerprint: expect.any(String),
      keyId: expect.any(String),
    });
  });
});
