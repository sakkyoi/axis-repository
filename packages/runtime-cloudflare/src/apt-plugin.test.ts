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
});
