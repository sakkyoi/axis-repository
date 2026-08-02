import { describe, expect, it } from "vitest";
import { resolvePluginIconAssets } from "@axis-repository/core/plugin-icons";
import { pypiPluginManifest } from "./manifest";

const manifest = pypiPluginManifest;

describe("PyPI plugin manifest", () => {
  it("identifies the ecosystem it configures", () => {
    expect(manifest.ecosystem).toBe("pypi");
    expect(manifest.repositoryConfig.namespace).toBe("pypi");
    expect(manifest.clientHelpers?.namespace).toBe("pypi");
    expect(manifest.capabilities.length).toBeGreaterThan(0);
  });

  it("names every helper action exactly once", () => {
    const names = manifest.clientHelpers?.actions.map((action) => action.name) ?? [];

    expect(names.length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name.trim()).not.toBe("");
    }
  });

  it("marks only unauthenticated-safe helper actions public", () => {
    // A public action bypasses repository read authorization.
    const publicActions = (manifest.clientHelpers?.actions ?? [])
      .filter((action) => action.public)
      .map((action) => action.name);

    expect(publicActions).toEqual(["simple-url"]);
  });

  it("provides a plugin-owned ecosystem icon", () => {
    expect(manifest.icon?.title).toBe("PyPI");
    expect(manifest.icon?.accentColor).toBe("#3775A9");
    expect(manifest.icon).toMatchObject({
      svgSource: {
        name: "PyPI logo-small.svg",
        url: "https://pypi.org/static/images/logo-small.0e0855d0.svg",
        rights: "PyPI warehouse source asset; PyPI and the blocks logos are PSF registered trademarks",
      },
    });
    expect(manifest.icon).not.toHaveProperty("shapes");
    const assets = resolvePluginIconAssets(manifest.icon);
    expect(assets.title).toBe("PyPI");
    expect(assets.accentColor).toBe("#3775A9");
    expect(assets.inlineSvg).toContain("viewBox=\"0 0 65.812 58\"");
    expect(assets.inlineSvg).toContain("#ffd242");
  });
});
