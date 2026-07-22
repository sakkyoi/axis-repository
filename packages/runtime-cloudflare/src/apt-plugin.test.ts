import { ValidationError, type Repository, type TokenPrincipal } from "@axis-repository/core";
import { describe, expect, it } from "vitest";
import { createAptPlugin } from "./apt-plugin";

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
      plugin.authorizePublish({
        repository: repository(),
        principal,
        artifacts: [],
      }),
    ).not.toThrow();
    expect(() =>
      plugin.authorizePublish({
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
    expect(plugin.clientHelpers?.actions).toEqual(["key.gpg", "source", "install"]);
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
});
