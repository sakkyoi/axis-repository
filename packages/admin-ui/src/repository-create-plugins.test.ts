import { describe, expect, it } from "vitest";
import {
  getRepositoryCreatePlugin,
  repositoryCreateAvailabilityError,
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
      steps: ["plugin", "basics", "config", "dependencies", "review"],
    });
    expect(getRepositoryCreatePlugin("pypi")).toMatchObject({
      ecosystem: "pypi",
      steps: ["plugin", "basics", "review"],
    });
  });

  it("derives create steps from repository config field steps", () => {
    expect(getRepositoryCreatePlugin("apt").steps).toEqual(["plugin", "basics", "config", "dependencies", "review"]);
    expect(getRepositoryCreatePlugin("pypi").steps).toEqual(["plugin", "basics", "review"]);
  });

  it("exposes repository config fields to the wizard renderer", () => {
    const plugin = getRepositoryCreatePlugin("apt");

    expect(plugin.repositoryConfig.namespace).toBe("apt");
    expect(plugin.repositoryConfig.fields.map((field) => [field.name, field.kind, field.step])).toEqual([
      ["codename", "text", "config"],
      ["components", "string-list", "config"],
      ["architectures", "string-list", "config"],
      ["signingKeyId", "signing-key", "dependencies"],
    ]);
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

  it("detects duplicate repository names before leaving the basics step", () => {
    expect(repositoryCreateAvailabilityError("debian-internal", ["debian-internal", "python-internal"]))
      .toBe("Repository already exists: debian-internal");
    expect(repositoryCreateAvailabilityError("debian-new", ["debian-internal", "python-internal"]))
      .toBeUndefined();
  });
});
