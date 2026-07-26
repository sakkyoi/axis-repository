import { describe, expect, it } from "vitest";
import { MemoryStateStore, NotFoundError, ValidationError, type Clock, type RandomId } from "@axis-repository/core";
import { MemoryRepositoryObjectStore } from "../storage/repository-object-store";
import { RepositoryRuntimePluginRegistry } from "./repository-runtime-plugin-registry";
import { RepositorySecretService } from "../storage/repository-secret-service";
import { SecretEncryption } from "../storage/secret-encryption";
import {
  ownsSecretNamespace,
  repositoryScopedObjectStoreFactory,
  scopeObjectStoreToRepository,
  scopeSecretsToEcosystem,
} from "./scoped-capabilities";

const clock: Clock = { now: () => new Date("2026-07-26T00:00:00.000Z") };

function sequentialRandomId(): RandomId {
  let counter = 0;
  return { create: (prefix) => `${prefix}_${++counter}` };
}

function createSecrets() {
  return new RepositorySecretService({
    state: new MemoryStateStore(),
    clock,
    randomId: sequentialRandomId(),
    encryption: new SecretEncryption("scoped-capabilities-test"),
  });
}

describe("ownsSecretNamespace", () => {
  it("claims the ecosystem namespace and everything below it", () => {
    expect(ownsSecretNamespace("apt", "apt")).toBe(true);
    expect(ownsSecretNamespace("apt", "apt.signing-key")).toBe(true);
    expect(ownsSecretNamespace("apt", "aptitude")).toBe(false);
    expect(ownsSecretNamespace("apt", "pypi.token")).toBe(false);
    expect(ownsSecretNamespace("pypi", "apt.signing-key")).toBe(false);
  });
});

describe("ecosystem ids that namespace ownership depends on", () => {
  it("refuses ids that could swallow another plugin's namespaces", () => {
    const registry = new RepositoryRuntimePluginRegistry();
    const descriptor = {
      ecosystem: "apt.extra",
      name: "apt-extra",
      version: "0.0.0",
      capabilities: [],
      canServeRepositoryPath: () => false,
      validateRepositoryConfig: () => undefined,
      publish: {
        validateArtifacts: () => undefined,
        authorize: () => undefined,
        finalize: async () => ({ publishedAt: "2026-07-26T00:00:00.000Z", objects: [] }),
      },
    };

    // ownsSecretNamespace treats "apt." as a prefix, so a plugin registered as
    // "apt" would own everything belonging to "apt.extra".
    expect(() => registry.register(descriptor)).toThrow(/lowercase alphanumeric/);
    for (const ecosystem of ["APT", "apt/x", "apt_x", "-apt", "", "apt.signing-key"]) {
      expect(() => registry.register({ ...descriptor, ecosystem }), ecosystem)
        .toThrow(/lowercase alphanumeric/);
    }
    expect(() => registry.register({ ...descriptor, ecosystem: "apt-extra" })).not.toThrow();
  });
});

describe("scopeSecretsToEcosystem", () => {
  it("stops one plugin from reading another plugin's secrets", async () => {
    const secrets = createSecrets();
    const apt = scopeSecretsToEcosystem(secrets, "apt");
    const pypi = scopeSecretsToEcosystem(secrets, "pypi");

    const aptKey = await apt.create({
      namespace: "apt.signing-key",
      repositoryName: "debian-internal",
      name: "release",
      publicMetadata: { fingerprint: "AAAA" },
      secrets: { privateKeyArmored: "private", passphrase: "secret" },
    });

    await expect(apt.getActive(aptKey.id)).resolves.toMatchObject({
      secrets: { privateKeyArmored: "private", passphrase: "secret" },
    });

    await expect(pypi.get(aptKey.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(pypi.getActive(aptKey.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(pypi.revoke(aptKey.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(pypi.list({ namespace: "apt.signing-key" })).rejects.toBeInstanceOf(ValidationError);
    await expect(pypi.create({
      namespace: "apt.signing-key",
      repositoryName: "debian-internal",
      name: "impostor",
      publicMetadata: {},
      secrets: { privateKeyArmored: "x", passphrase: "y" },
    })).rejects.toBeInstanceOf(ValidationError);

    // A refused revoke must not have mutated anything.
    await expect(apt.get(aptKey.id)).resolves.toMatchObject({ revokedAt: null });
  });

  it("leaves a plugin free inside its own namespaces", async () => {
    const secrets = createSecrets();
    const pypi = scopeSecretsToEcosystem(secrets, "pypi");

    const record = await pypi.create({
      namespace: "pypi",
      repositoryName: "python-internal",
      name: "upstream",
      publicMetadata: {},
      secrets: { token: "abc" },
    });

    await expect(pypi.list({ namespace: "pypi" })).resolves.toHaveLength(1);
    await expect(pypi.revoke(record.id)).resolves.toMatchObject({ revokedAt: expect.any(String) });
  });
});

describe("scopeObjectStoreToRepository", () => {
  it("confines writes to the repository key space", async () => {
    const store = new MemoryRepositoryObjectStore();
    const scoped = scopeObjectStoreToRepository(store, "debian-internal");

    await scoped.putText("repositories/debian-internal/dists/noble/Release", "ok", "text/plain");

    for (const key of [
      "repositories/debian-other/dists/noble/Release",
      "repositories/debian-internal-suffix/x",
      "_staging/uploads/debian-internal/s/u/evil",
      "repository-secret:anything",
      "",
    ]) {
      await expect(scoped.putText(key, "x", "text/plain")).rejects.toBeInstanceOf(ValidationError);
      await expect(scoped.deleteObject(key)).rejects.toBeInstanceOf(ValidationError);
    }

    await expect(
      scoped.copyObject("_staging/uploads/debian-internal/s/u/a.deb", "repositories/debian-other/pool/a.deb"),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(store.objects.map((object) => object.key)).toEqual([
      "repositories/debian-internal/dists/noble/Release",
    ]);
  });

  it("allows reads from the repository and the staging area only", async () => {
    const store = new MemoryRepositoryObjectStore();
    await store.putText("repositories/debian-internal/pool/a.deb", "mine", "text/plain");
    await store.putText("repositories/debian-other/pool/b.deb", "theirs", "text/plain");
    await store.putText("_staging/uploads/debian-internal/s/u/a.deb", "staged", "text/plain");
    await store.putText("_staging/uploads/debian-other/s/u/b.deb", "not mine", "text/plain");
    const scoped = scopeObjectStoreToRepository(store, "debian-internal");

    await expect(scoped.headObject("repositories/debian-internal/pool/a.deb")).resolves.not.toBeNull();
    await expect(scoped.getObject("_staging/uploads/debian-internal/s/u/a.deb")).resolves.not.toBeNull();
    // Another repository's in-flight uploads stay out of reach.
    await expect(scoped.getObject("_staging/uploads/debian-other/s/u/b.deb"))
      .rejects.toBeInstanceOf(ValidationError);
    await expect(scoped.listObjects({ prefix: "_staging/" })).rejects.toBeInstanceOf(ValidationError);
    await expect(
      scoped.copyObject("_staging/uploads/debian-other/s/u/b.deb", "repositories/debian-internal/pool/b.deb"),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(scoped.getObject("repositories/debian-other/pool/b.deb")).rejects.toBeInstanceOf(ValidationError);
    await expect(scoped.listObjects({ prefix: "repositories/debian-other/" })).rejects.toBeInstanceOf(ValidationError);

    // Copying a verified upload into the repository stays allowed.
    await expect(
      scoped.copyObject("_staging/uploads/debian-internal/s/u/a.deb", "repositories/debian-internal/pool/a.deb"),
    ).resolves.toBeUndefined();
  });
});

describe("repositoryScopedObjectStoreFactory", () => {
  it("confines each repository's publisher to its own key space", async () => {
    const store = new MemoryRepositoryObjectStore();
    const objectStoreFor = repositoryScopedObjectStoreFactory(store);

    const first = objectStoreFor("debian-internal");
    const second = objectStoreFor("debian-staging");

    await first.putText("repositories/debian-internal/dists/noble/Release", "a", "text/plain");
    await second.putText("repositories/debian-staging/dists/noble/Release", "b", "text/plain");

    // A publisher holding one repository's store cannot reach another's, which
    // is what makes the publish path scoped rather than conventional.
    await expect(
      first.putText("repositories/debian-staging/dists/noble/Release", "hijacked", "text/plain"),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      first.getObject("repositories/debian-staging/dists/noble/Release"),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(store.objects.map((object) => object.key).sort()).toEqual([
      "repositories/debian-internal/dists/noble/Release",
      "repositories/debian-staging/dists/noble/Release",
    ]);
  });
});

