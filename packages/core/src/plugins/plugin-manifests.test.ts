import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcDir = dirname(fileURLToPath(import.meta.url));

describe("shared plugin manifests", () => {
  it("declares manifest types without naming any concrete ecosystem", () => {
    // core is the bottom layer: it owns the manifest shape, and the plugin
    // packages own their values. Each plugin asserts its own manifest
    // invariants in its own package.
    const coreManifestTypes = readFileSync(join(srcDir, "plugin-manifests.ts"), "utf8");

    expect(coreManifestTypes).not.toContain("aptPluginManifest");
    expect(coreManifestTypes).not.toContain("pypiPluginManifest");
  });
});
