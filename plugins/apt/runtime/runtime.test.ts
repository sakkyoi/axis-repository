import { ValidationError, type Repository, type TokenPrincipal } from "@axis-repository/core";
import { describe, expect, it } from "vitest";
import { createAptPlugin } from "./runtime";

function repository(config: Record<string, unknown> = {
  apt: {
    codename: "noble",
    components: ["main"],
    architectures: ["amd64"],
    signingKeyId: "signing_key_prod",
  },
}): Repository {
  return {
    id: "repo_1",
    name: "debian-internal",
    ecosystem: "apt",
    visibility: "private",
    config,
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
  };
}

const principal: TokenPrincipal = {
  tokenId: "ptok_1",
  name: "ci",
  permissions: ["publish"],
  repositories: ["debian-internal"],
  ecosystemScopes: {},
  signingKeyIds: ["signing_key_prod"],
};

describe("APT plugin lifecycle", () => {
  it("validates repository config", () => {
    const plugin = createAptPlugin({
      publisher: { publish: async () => ({ publishedAt: "2026-07-18T00:00:00.000Z", objects: [] }) },
    });

    expect(() =>
      plugin.validateRepositoryConfig({
        ecosystem: "apt",
        config: repository().config,
      }),
    ).not.toThrow();
    expect(() =>
      plugin.validateRepositoryConfig({
        ecosystem: "apt",
        config: { apt: { components: ["main"], architectures: ["amd64"] } },
      }),
    ).toThrow("config.apt.codename is required");
  });

  it("authorizes publish tokens against the repository signing key", () => {
    const plugin = createAptPlugin({
      publisher: { publish: async () => ({ publishedAt: "2026-07-18T00:00:00.000Z", objects: [] }) },
    });

    expect(() =>
      plugin.publish.authorize({
        repository: repository(),
        principal,
        artifacts: [],
      }),
    ).not.toThrow();
    expect(() =>
      plugin.publish.authorize({
        repository: repository(),
        principal: { ...principal, signingKeyIds: [] },
        artifacts: [],
      }),
    ).toThrow(new ValidationError("Publish token is not scoped to the repository signing key"));
  });

  it("serves APT client helpers from plugin policy", async () => {
    const plugin = createAptPlugin({
      publisher: { publish: async () => ({ publishedAt: "2026-07-18T00:00:00.000Z", objects: [] }) },
    });

    expect(plugin.clientHelpers?.namespace).toBe("apt");
    expect(plugin.clientHelpers?.actions).toEqual([
      {
        name: "key.gpg",
        label: "key.gpg",
        responseKind: "text",
        defaultOpen: false,
        public: true,
      },
      {
        name: "source",
        label: "source",
        responseKind: "json",
        defaultOpen: false,
        public: true,
      },
      {
        name: "install",
        label: "install",
        responseKind: "shell",
        defaultOpen: true,
        public: true,
      },
    ]);
    expect(plugin.clientHelpers?.isPublic("key.gpg")).toBe(true);
    const keyResponse = await plugin.clientHelpers?.handle({
      repository: repository(),
      action: "key.gpg",
      origin: "https://axis.example",
      signingKeys: {
        getPublicKey: async () => ({
          publicKeyArmored: "-----BEGIN PGP PUBLIC KEY BLOCK-----",
        }),
      },
    });
    const installResponse = await plugin.clientHelpers?.handle({
      repository: repository(),
      action: "install",
      origin: "https://axis.example",
      signingKeys: {
        getPublicKey: async () => ({
          publicKeyArmored: "unused",
        }),
      },
    });

    expect(keyResponse?.headers.get("content-type")).toBe("application/pgp-keys");
    await expect(keyResponse?.text()).resolves.toBe("-----BEGIN PGP PUBLIC KEY BLOCK-----");
    await expect(installResponse?.json()).resolves.toMatchObject({
      repository: "debian-internal",
      script: expect.stringContaining("# Install the repository signing key."),
    });
  });

  it("serves APT signing keys from plugin admin resources", async () => {
    const calls: Array<{ method: string; input?: unknown }> = [];
    const signingKey = {
      id: "signing_key_prod",
      repositoryName: "debian-internal",
      name: "release",
      publicKeyArmored: "-----BEGIN PGP PUBLIC KEY BLOCK-----",
      fingerprint: "FINGERPRINT",
      keyId: "KEYID",
      createdAt: "2026-07-22T00:00:00.000Z",
      revokedAt: null,
    };
    const plugin = createAptPlugin({
      publisher: { publish: async () => ({ publishedAt: "2026-07-18T00:00:00.000Z", objects: [] }) },
    });
    const services = {
      signingKeys: {
        listForRepository: async (repositoryName: string) => {
          calls.push({ method: "listForRepository", input: repositoryName });
          return [signingKey];
        },
        generate: async (input: unknown) => {
          calls.push({ method: "generate", input });
          return signingKey;
        },
        create: async (input: unknown) => {
          calls.push({ method: "create", input });
          return signingKey;
        },
        getPublicKey: async (id: string) => {
          calls.push({ method: "getPublicKey", input: id });
          return signingKey;
        },
        getActivePrivateKey: async (id: string) => {
          calls.push({ method: "getActivePrivateKey", input: id });
          return {
            id,
            repositoryName: "debian-internal",
            privateKeyArmored: "-----BEGIN PGP PRIVATE KEY BLOCK-----",
            passphrase: "passphrase",
            fingerprint: "FINGERPRINT",
            keyId: "KEYID",
          };
        },
        revoke: async (id: string) => {
          calls.push({ method: "revoke", input: id });
          return { ...signingKey, revokedAt: "2026-07-23T00:00:00.000Z" };
        },
      },
    };

    expect(plugin.adminResources?.namespace).toBe("apt");
    await expect(plugin.adminResources?.handle({
      repositoryName: "debian-internal",
      repository: repository(),
      request: new Request("https://axis.example/admin/repositories/debian-internal/apt/signing-keys"),
      path: ["signing-keys"],
      services,
    }).then((response) => response.json())).resolves.toEqual({ signingKeys: [signingKey] });
    await expect(plugin.adminResources?.handle({
      repositoryName: "debian-internal",
      repository: repository(),
      request: new Request("https://axis.example/admin/repositories/debian-internal/apt/signing-keys/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "release",
          userIdName: "Axis Repository",
          userIdEmail: "axis@example.test",
        }),
      }),
      path: ["signing-keys", "generate"],
      services,
    }).then((response) => response.status)).resolves.toBe(201);
    await expect(plugin.adminResources?.handle({
      repositoryName: "debian-internal",
      repository: repository(),
      request: new Request("https://axis.example/admin/repositories/debian-internal/apt/signing-keys/signing_key_prod/revoke", {
        method: "POST",
      }),
      path: ["signing-keys", "signing_key_prod", "revoke"],
      services,
    }).then((response) => response.json())).resolves.toMatchObject({ revokedAt: "2026-07-23T00:00:00.000Z" });

    expect(calls).toEqual([
      { method: "listForRepository", input: "debian-internal" },
      {
        method: "generate",
        input: {
          repositoryName: "debian-internal",
          name: "release",
          userIdName: "Axis Repository",
          userIdEmail: "axis@example.test",
        },
      },
      { method: "getPublicKey", input: "signing_key_prod" },
      { method: "revoke", input: "signing_key_prod" },
    ]);
  });
});
