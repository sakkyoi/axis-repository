import { describe, expect, it } from "vitest";

import {
  getRepositoryUiPlugin,
  repositoryCreatePluginOptionsFromUiRegistry,
  repositoryCreatePluginsFromUiRegistry,
  repositoryDetailPluginsFromUiRegistry,
  repositoryUiPlugins,
} from "./repository-ui-plugins";

describe("repository UI plugin registry", () => {
  it("registers each ecosystem once with both create and detail UI support", () => {
    expect(repositoryUiPlugins.map((plugin) => plugin.manifest.ecosystem)).toEqual(["apt", "pypi"]);
    expect(repositoryUiPlugins.map((plugin) => [plugin.create.ecosystem, plugin.detail.ecosystem])).toEqual([
      ["apt", "apt"],
      ["pypi", "pypi"],
    ]);
  });

  it("derives UI plugin metadata from the shared core manifest", () => {
    const apt = getRepositoryUiPlugin("apt");

    expect(apt?.manifest).toMatchObject({
      ecosystem: "apt",
      displayName: "APT",
      description: "Debian package repositories with signed Release metadata.",
    });
    expect("displayName" in apt!).toBe(false);
    expect("displayName" in apt!.create).toBe(false);
    expect("description" in apt!.create).toBe(false);
    expect("capabilities" in apt!.create).toBe(false);
    expect("displayName" in apt!.detail).toBe(false);
  });

  it("provides create and detail registry views from the same UI plugin entries", () => {
    expect(repositoryCreatePluginsFromUiRegistry()).toEqual(repositoryUiPlugins.map((plugin) => plugin.create));
    expect(repositoryDetailPluginsFromUiRegistry()).toEqual(repositoryUiPlugins.map((plugin) => plugin.detail));
  });

  it("returns undefined for ecosystems without local UI support", () => {
    expect(getRepositoryUiPlugin("npm")).toBeUndefined();
  });

  it("builds create plugin options from the UI plugin registry", () => {
    const options = repositoryCreatePluginOptionsFromUiRegistry([
      {
        ecosystem: "apt",
        name: "apt-signed",
        version: "0.1.0",
        capabilities: ["signed-release"],
      },
      {
        ecosystem: "npm",
        name: "npm-registry",
        version: "0.1.0",
        capabilities: ["package-index"],
      },
    ]);

    expect(options.map((option) => [option.ecosystem, option.supported])).toEqual([
      ["apt", true],
      ["npm", false],
    ]);
    expect(options[0]).toMatchObject({
      ecosystem: "apt",
      displayName: "APT",
      supported: true,
    });
  });

  it("lets ecosystem UI plugins map create errors for their own config and dependencies", () => {
    expect(getRepositoryUiPlugin("apt")?.mapCreateServerError?.("Signing key is required")).toBe("dependencies");
    expect(getRepositoryUiPlugin("apt")?.mapCreateServerError?.("config.apt.codename is required")).toBe("config");
    expect(getRepositoryUiPlugin("pypi")?.mapCreateServerError?.("Signing key is required")).toBeUndefined();
  });
});
