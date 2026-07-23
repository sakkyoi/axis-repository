import { aptPluginManifest } from "../../../plugins/apt/manifest";
import { pypiPluginManifest } from "../../../plugins/pypi/manifest";
import { describe, expect, it } from "vitest";
import { createDefaultArtifactPlugins } from "./default-plugins";

describe("default artifact plugins", () => {
  it("keeps runtime plugin ecosystems aligned with shared core manifests", () => {
    const registry = createDefaultArtifactPlugins({
      objectStore: {} as never,
      signingKeyService: {} as never,
    });

    expect(registry.list().map((plugin) => plugin.ecosystem)).toEqual([
      aptPluginManifest.ecosystem,
      pypiPluginManifest.ecosystem,
    ]);
  });
});
