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
        experimental: false,
        runtime: true,
        adminUi: true,
      }),
    ]);
  });

  it("exposes stable catalog lookup and metadata views", () => {
    expect(repositoryPluginCatalogEcosystems()).toEqual(["apt", "pypi"]);
    expect(getRepositoryPluginCatalogEntry("apt")?.manifest.displayName).toBe("APT");
    expect(getRepositoryPluginCatalogEntry("apt")?.icon.title).toBe("APT");
    expect(getRepositoryPluginCatalogEntry("pypi")?.icon.title).toBe("PyPI");
    expect(getRepositoryPluginCatalogEntry("npm")).toBeUndefined();
    expect(repositoryPluginCatalogMetadata()).toEqual([
      expect.objectContaining({ ecosystem: "apt", enabled: true, experimental: false, runtime: true, adminUi: true }),
      expect.objectContaining({ ecosystem: "pypi", enabled: true, experimental: false, runtime: true, adminUi: true }),
    ]);
    expect(repositoryPluginCatalogMetadata().map((entry) => entry.icon.title)).toEqual(["APT", "PyPI"]);
  });

  it("keeps catalog ecosystems unique", () => {
    const ecosystems = repositoryPluginCatalogEcosystems();

    expect(new Set(ecosystems).size).toBe(ecosystems.length);
  });
});
