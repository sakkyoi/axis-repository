import { describe, expect, it } from "vitest";

import {
  getRepositoryUiPlugin,
  repositoryCreatePluginsFromUiRegistry,
  repositoryDetailPluginsFromUiRegistry,
  repositoryUiPlugins,
} from "./repository-ui-plugins";

describe("repository UI plugin registry", () => {
  it("registers each ecosystem once with both create and detail UI support", () => {
    expect(repositoryUiPlugins.map((plugin) => plugin.ecosystem)).toEqual(["apt", "pypi"]);
    expect(repositoryUiPlugins.map((plugin) => [plugin.create.ecosystem, plugin.detail.ecosystem])).toEqual([
      ["apt", "apt"],
      ["pypi", "pypi"],
    ]);
  });

  it("provides create and detail registry views from the same UI plugin entries", () => {
    expect(repositoryCreatePluginsFromUiRegistry()).toEqual(repositoryUiPlugins.map((plugin) => plugin.create));
    expect(repositoryDetailPluginsFromUiRegistry()).toEqual(repositoryUiPlugins.map((plugin) => plugin.detail));
  });

  it("returns undefined for ecosystems without local UI support", () => {
    expect(getRepositoryUiPlugin("npm")).toBeUndefined();
  });

  it("lets ecosystem UI plugins map create errors for their own config and dependencies", () => {
    expect(getRepositoryUiPlugin("apt")?.mapCreateServerError?.("Signing key is required")).toBe("dependencies");
    expect(getRepositoryUiPlugin("apt")?.mapCreateServerError?.("config.apt.codename is required")).toBe("config");
    expect(getRepositoryUiPlugin("pypi")?.mapCreateServerError?.("Signing key is required")).toBeUndefined();
  });
});
