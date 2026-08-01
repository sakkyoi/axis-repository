import type { RepositoryPluginBundle } from "@axis-repository/core/plugin-manifests";
import { aptRepositoryPluginBundle } from "@axis-repository/plugin-apt";
import { pypiRepositoryPluginBundle } from "@axis-repository/plugin-pypi";

export const bundledRepositoryPlugins = [
  aptRepositoryPluginBundle,
  pypiRepositoryPluginBundle,
] as const satisfies readonly RepositoryPluginBundle[];
