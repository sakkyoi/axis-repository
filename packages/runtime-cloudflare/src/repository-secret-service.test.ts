import { describe, expect, it } from "vitest";
import { MemoryStateStore, NotFoundError, ValidationError, type Clock, type RandomId } from "@axis-repository/core";
import { SecretEncryption } from "./secret-encryption";
import { RepositorySecretService } from "./repository-secret-service";

const clock: Clock = { now: () => new Date("2026-07-18T00:00:00.000Z") };
const randomId: RandomId = { create: (prefix) => `${prefix}_fixed` };

describe("RepositorySecretService", () => {
  it("stores encrypted repository-scoped secrets behind a generic capability", async () => {
    const state = new MemoryStateStore();
    const service = new RepositorySecretService({
      state,
      clock,
      randomId,
      encryption: new SecretEncryption("local-test-secret"),
    });

    const created = await service.create({
      namespace: "apt.signing-key",
      repositoryName: "debian-prod",
      name: "release",
      publicMetadata: {
        publicKeyArmored: "public-key",
        fingerprint: "FINGERPRINT",
        keyId: "KEYID",
      },
      secrets: {
        privateKeyArmored: "private-key",
        passphrase: "passphrase",
      },
    });

    expect(created).toEqual({
      id: "signing_key_fixed",
      namespace: "apt.signing-key",
      repositoryName: "debian-prod",
      name: "release",
      publicMetadata: {
        publicKeyArmored: "public-key",
        fingerprint: "FINGERPRINT",
        keyId: "KEYID",
      },
      createdAt: "2026-07-18T00:00:00.000Z",
      revokedAt: null,
    });
    expect(JSON.stringify(await state.signingKeys.getById("signing_key_fixed"))).not.toContain("private-key");
    await expect(service.getActive("signing_key_fixed")).resolves.toMatchObject({
      secrets: {
        privateKeyArmored: "private-key",
        passphrase: "passphrase",
      },
    });
    await expect(service.list({ namespace: "apt.signing-key", repositoryName: "debian-prod" })).resolves.toEqual([
      created,
    ]);
  });

  it("fails closed for unsupported secret namespaces and revoked active secrets", async () => {
    const service = new RepositorySecretService({
      state: new MemoryStateStore(),
      clock,
      randomId,
      encryption: new SecretEncryption("local-test-secret"),
    });

    await expect(service.create({
      namespace: "npm.token",
      repositoryName: "npm-prod",
      name: "release",
      publicMetadata: {},
      secrets: { token: "secret" },
    })).rejects.toThrow(new ValidationError("Repository secret namespace is not supported: npm.token"));

    await expect(service.getActive("missing")).rejects.toBeInstanceOf(NotFoundError);
  });
});
