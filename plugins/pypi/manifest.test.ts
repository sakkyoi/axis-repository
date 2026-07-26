import { describe, expect, it } from "vitest";
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
});
