import { describe, expect, it } from "vitest";
import {
  getRepositoryCreatePlugin,
  repositoryCreatePluginOptions,
  repositoryCreatePlugins,
} from "./repository-create-plugins";

describe("repository create plugins", () => {
  it("exposes APT as a wizard plugin with config and dependency steps", () => {
    expect(repositoryCreatePlugins.map((plugin) => plugin.ecosystem)).toEqual(["apt"]);
    expect(getRepositoryCreatePlugin("apt")).toMatchObject({
      ecosystem: "apt",
      displayName: "APT",
      steps: ["plugin", "basics", "config", "dependencies", "review"],
    });
  });

  it("builds an APT repository create payload from wizard state", () => {
    const plugin = getRepositoryCreatePlugin("apt");

    expect(plugin.buildCreateInput({
      name: "debian-internal",
      visibility: "private",
      config: {
        codename: "noble",
        components: "main contrib",
        architectures: "amd64 arm64",
      },
      dependencies: {
        signingKeyId: "signing_key_prod",
      },
    })).toEqual({
      name: "debian-internal",
      ecosystem: "apt",
      visibility: "private",
      config: {
        apt: {
          codename: "noble",
          components: ["main", "contrib"],
          architectures: ["amd64", "arm64"],
          signingKeyId: "signing_key_prod",
        },
      },
    });
  });

  it("uses server plugin metadata to expose only create plugins supported by both sides", () => {
    const options = repositoryCreatePluginOptions([
      {
        ecosystem: "apt",
        name: "apt-signed",
        version: "0.1.0",
        capabilities: ["signed-release", "client-helpers"],
      },
      {
        ecosystem: "npm",
        name: "npm-registry",
        version: "0.1.0",
        capabilities: ["package-index"],
      },
    ]);

    expect(options).toEqual([
      {
        ecosystem: "apt",
        displayName: "APT",
        description: "Debian package repositories with signed Release metadata.",
        capabilities: ["signed-release", "client-helpers"],
        supported: true,
        plugin: getRepositoryCreatePlugin("apt"),
      },
      {
        ecosystem: "npm",
        displayName: "npm",
        description: "Server plugin is enabled, but this admin UI cannot create it yet.",
        capabilities: ["package-index"],
        supported: false,
      },
    ]);
  });

  it("does not offer local create plugins that are not enabled by the server", () => {
    expect(repositoryCreatePluginOptions([])).toEqual([]);
  });
});
