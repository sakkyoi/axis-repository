import type { RepositoryPluginManifest } from "@axis-repository/core/plugin-manifests";
import { aptRepositoryPluginBundle } from "./apt/plugin";
import { pypiRepositoryPluginBundle } from "./pypi/plugin";

export interface RepositoryPluginBundle {
  manifest: RepositoryPluginManifest;
  catalog: {
    enabled: boolean;
    experimental: boolean;
  };
  runtime: boolean;
  adminUi: boolean;
}

export const bundledRepositoryPlugins = [
  aptRepositoryPluginBundle,
  pypiRepositoryPluginBundle,
] as const satisfies readonly RepositoryPluginBundle[];
