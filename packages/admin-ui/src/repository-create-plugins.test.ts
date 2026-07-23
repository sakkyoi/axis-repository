import { describe, expect, it } from "vitest";
import {
  getRepositoryCreatePlugin,
  repositoryCreateFieldErrors,
  repositoryCreatePluginOptions,
  repositoryCreatePlugins,
  repositoryCreateStepForServerError,
} from "./repository-create-plugins";

describe("repository create plugins", () => {
  it("exposes APT as a wizard plugin with config and dependency steps", () => {
    expect(repositoryCreatePlugins.map((plugin) => plugin.ecosystem)).toEqual(["apt", "pypi"]);
    expect(getRepositoryCreatePlugin("apt")).toMatchObject({
      ecosystem: "apt",
      displayName: "APT",
      steps: ["plugin", "basics", "config", "dependencies", "review"],
    });
    expect(getRepositoryCreatePlugin("pypi")).toMatchObject({
      ecosystem: "pypi",
      displayName: "PyPI",
      steps: ["plugin", "basics", "review"],
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

  it("builds a PyPI repository create payload from wizard state", () => {
    const plugin = getRepositoryCreatePlugin("pypi");

    expect(plugin.buildCreateInput({
      name: "python-internal",
      visibility: "private",
      config: {},
      dependencies: {},
    })).toEqual({
      name: "python-internal",
      ecosystem: "pypi",
      visibility: "private",
      config: {
        pypi: {},
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
        ecosystem: "pypi",
        name: "pypi-simple",
        version: "0.1.0",
        capabilities: ["simple-api", "client-helpers"],
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
        ecosystem: "pypi",
        displayName: "PyPI",
        description: "Python package repositories using the Simple Repository API.",
        capabilities: ["simple-api", "client-helpers"],
        supported: true,
        plugin: getRepositoryCreatePlugin("pypi"),
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

  it("maps duplicate repository errors back to the basics step and name field", () => {
    const plugin = getRepositoryCreatePlugin("apt");
    const message = "Repository already exists: debian-internal";

    expect(repositoryCreateStepForServerError(message, plugin)).toBe("basics");
    expect(repositoryCreateFieldErrors(message)).toEqual({
      name: "Repository already exists: debian-internal",
    });
  });
});
