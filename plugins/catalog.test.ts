import { describe, expect, it } from "vitest";
import {
  getRepositoryPluginCatalogEntry,
  repositoryPluginCatalog,
  repositoryPluginCatalogEcosystems,
  repositoryPluginCatalogMetadata,
} from "./catalog";

describe("repository plugin catalog", () => {
  it("declares lifecycle metadata for each ecosystem", () => {
    expect(repositoryPluginCatalog).toEqual([
      expect.objectContaining({
        manifest: expect.objectContaining({ ecosystem: "apt" }),
        enabled: true,
        experimental: false,
        runtime: true,
        adminUi: true,
      }),
      expect.objectContaining({
        manifest: expect.objectContaining({ ecosystem: "pypi" }),
        enabled: true,
        experimental: true,
        runtime: true,
        adminUi: true,
      }),
    ]);
  });

  it("exposes stable catalog lookup and metadata views", () => {
    expect(repositoryPluginCatalogEcosystems()).toEqual(["apt", "pypi"]);
    expect(getRepositoryPluginCatalogEntry("apt")?.manifest.displayName).toBe("APT");
    expect(getRepositoryPluginCatalogEntry("npm")).toBeUndefined();
    expect(repositoryPluginCatalogMetadata()).toEqual([
      { ecosystem: "apt", enabled: true, experimental: false, runtime: true, adminUi: true },
      { ecosystem: "pypi", enabled: true, experimental: true, runtime: true, adminUi: true },
    ]);
  });

  it("keeps catalog ecosystems unique", () => {
    const ecosystems = repositoryPluginCatalogEcosystems();

    expect(new Set(ecosystems).size).toBe(ecosystems.length);
  });
});
