import { aptPluginManifest } from "@axis-repository/plugin-apt/manifest";
import { pypiPluginManifest } from "@axis-repository/plugin-pypi/manifest";
import { describe, expect, it } from "vitest";
import { createDefaultArtifactPlugins } from "./default-plugins";

describe("default artifact plugins", () => {
  it("keeps runtime plugin ecosystems aligned with shared core manifests", () => {
    const registry = createDefaultArtifactPlugins({
      objectStore: {} as never,
      secrets: {} as never,
    });

    expect(registry.list().map((plugin) => ({
      ecosystem: plugin.ecosystem,
      repositoryKinds: plugin.repositoryKinds,
    }))).toEqual([
      { ecosystem: aptPluginManifest.ecosystem, repositoryKinds: [{ kind: "hosted", experimental: false }] },
      { ecosystem: aptPluginManifest.ecosystem, repositoryKinds: [{ kind: "proxy", experimental: false }] },
      { ecosystem: aptPluginManifest.ecosystem, repositoryKinds: [{ kind: "group", experimental: true }] },
      { ecosystem: pypiPluginManifest.ecosystem, repositoryKinds: [{ kind: "hosted", experimental: false }] },
      { ecosystem: pypiPluginManifest.ecosystem, repositoryKinds: [{ kind: "proxy", experimental: false }] },
      { ecosystem: pypiPluginManifest.ecosystem, repositoryKinds: [{ kind: "group", experimental: false }] },
    ]);
  });
});
