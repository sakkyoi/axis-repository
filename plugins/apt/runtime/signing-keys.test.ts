import { describe, expect, it } from "vitest";
import { MemoryStateStore, type Clock, type RandomId } from "@axis-repository/core";
import { RepositorySecretService, SecretEncryption } from "@axis-repository/runtime-cloudflare/plugin-runtime/testing";
import { AptSigningKeyResource } from "./signing-keys";

const clock: Clock = { now: () => new Date("2026-07-18T00:00:00.000Z") };
const randomId: RandomId = { create: (prefix) => `${prefix}_fixed` };

describe("AptSigningKeyResource", () => {
  it("owns APT signing key behavior on top of generic repository secrets", async () => {
    const resource = new AptSigningKeyResource({
      secrets: new RepositorySecretService({
        state: new MemoryStateStore(),
        clock,
        randomId,
        encryption: new SecretEncryption("local-test-secret"),
      }),
    });

    const generated = await resource.generate({
      repositoryName: "debian-prod",
      name: "release",
      userIdName: "Axis Repository",
      userIdEmail: "axis@example.test",
    });

    expect(generated).toMatchObject({
      id: "signing_key_fixed",
      repositoryName: "debian-prod",
      name: "release",
      publicKeyArmored: expect.stringContaining("BEGIN PGP PUBLIC KEY BLOCK"),
      fingerprint: expect.any(String),
      keyId: expect.any(String),
      createdAt: "2026-07-18T00:00:00.000Z",
      revokedAt: null,
    });
    await expect(resource.getActivePrivateKey("signing_key_fixed")).resolves.toMatchObject({
      privateKeyArmored: expect.stringContaining("BEGIN PGP PRIVATE KEY BLOCK"),
      passphrase: "pgp_passphrase_fixed",
    });
  });
});
