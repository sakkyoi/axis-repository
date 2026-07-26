import { describe, expect, it } from "vitest";
import { MemoryStateStore, NotFoundError, ValidationError, type Clock, type RandomId } from "@axis-repository/core";
import { RepositorySecretService, SecretEncryption } from "@axis-repository/runtime-cloudflare/plugin-runtime/testing";
import { AptSigningKeyResource } from "./signing-keys";

const clock: Clock = { now: () => new Date("2026-07-18T00:00:00.000Z") };

function sequentialRandomId(): RandomId {
  let counter = 0;
  return { create: (prefix) => `${prefix}_${++counter}` };
}

function createResource(randomId: RandomId = { create: (prefix) => `${prefix}_fixed` }) {
  const secrets = new RepositorySecretService({
    state: new MemoryStateStore(),
    clock,
    randomId,
    encryption: new SecretEncryption("local-test-secret"),
  });
  return { resource: new AptSigningKeyResource({ secrets }), secrets };
}

describe("AptSigningKeyResource", () => {
  it("owns APT signing key behavior on top of generic repository secrets", async () => {
    const { resource } = createResource();

    const generated = await resource.generate({
      repositoryName: "debian-prod",
      name: "release",
      userIdName: "Axis Repository",
      userIdEmail: "axis@example.test",
    });

    expect(generated).toMatchObject({
      id: "repository_secret_fixed",
      repositoryName: "debian-prod",
      name: "release",
      publicKeyArmored: expect.stringContaining("BEGIN PGP PUBLIC KEY BLOCK"),
      fingerprint: expect.any(String),
      keyId: expect.any(String),
      createdAt: "2026-07-18T00:00:00.000Z",
      revokedAt: null,
    });
    await expect(resource.getActivePrivateKey(generated.id, "debian-prod")).resolves.toMatchObject({
      privateKeyArmored: expect.stringContaining("BEGIN PGP PRIVATE KEY BLOCK"),
      passphrase: "pgp_passphrase_fixed",
    });
  });

  it("refuses to hand a repository the private key of another repository", async () => {
    const { resource } = createResource(sequentialRandomId());
    const owned = await resource.generate({
      repositoryName: "debian-prod",
      name: "release",
      userIdName: "Axis Repository",
      userIdEmail: "axis@example.test",
    });

    await expect(resource.getActivePrivateKey(owned.id, "debian-staging"))
      .rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses to use a revoked signing key", async () => {
    const { resource } = createResource(sequentialRandomId());
    const generated = await resource.generate({
      repositoryName: "debian-prod",
      name: "release",
      userIdName: "Axis Repository",
      userIdEmail: "axis@example.test",
    });

    await resource.revoke(generated.id);

    await expect(resource.getActivePrivateKey(generated.id, "debian-prod"))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses to read secrets that are not APT signing keys", async () => {
    const { resource, secrets } = createResource(sequentialRandomId());
    const foreign = await secrets.create({
      namespace: "other.plugin",
      repositoryName: "debian-prod",
      name: "api-credentials",
      publicMetadata: { publicKeyArmored: "x", fingerprint: "y", keyId: "z" },
      secrets: { privateKeyArmored: "leak", passphrase: "leak" },
    });

    await expect(resource.getPublicKey(foreign.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(resource.getActivePrivateKey(foreign.id, "debian-prod"))
      .rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects an unusable private key or passphrase on import", async () => {
    const { resource } = createResource(sequentialRandomId());

    await expect(resource.create({
      repositoryName: "debian-prod",
      name: "release",
      privateKeyArmored: "not-a-pgp-key",
      passphrase: "whatever",
    })).rejects.toBeInstanceOf(ValidationError);
  });

  it("requires a repository name and a key name", async () => {
    const { resource } = createResource(sequentialRandomId());

    await expect(resource.create({
      repositoryName: "  ",
      name: "release",
      privateKeyArmored: "x",
      passphrase: "y",
    })).rejects.toBeInstanceOf(ValidationError);
    await expect(resource.create({
      repositoryName: "debian-prod",
      name: "  ",
      privateKeyArmored: "x",
      passphrase: "y",
    })).rejects.toBeInstanceOf(ValidationError);
  });
});
