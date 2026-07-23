import type { RepositoryCreatePlugin, RepositoryCreateStep } from "./repository-create-plugins";
import type { RepositoryDetailPlugin } from "./repository-detail-plugins";
import { aptRepositoryUiPlugin } from "./plugins/apt";
import { pypiRepositoryUiPlugin } from "./plugins/pypi";

type NonEmptyArray<T> = [T, ...T[]];

export interface RepositoryUiPlugin {
  ecosystem: string;
  displayName: string;
  create: RepositoryCreatePlugin;
  detail: RepositoryDetailPlugin;
  mapCreateServerError?: (message: string) => RepositoryCreateStep | undefined;
}

export const repositoryUiPlugins = [
  aptRepositoryUiPlugin,
  pypiRepositoryUiPlugin,
] satisfies NonEmptyArray<RepositoryUiPlugin>;

export function getRepositoryUiPlugin(ecosystem: string): RepositoryUiPlugin | undefined {
  return repositoryUiPlugins.find((plugin) => plugin.ecosystem === ecosystem);
}

export function repositoryCreatePluginsFromUiRegistry(): NonEmptyArray<RepositoryCreatePlugin> {
  return repositoryUiPlugins.map((plugin) => plugin.create) as NonEmptyArray<RepositoryCreatePlugin>;
}

export function repositoryDetailPluginsFromUiRegistry(): RepositoryDetailPlugin[] {
  return repositoryUiPlugins.map((plugin) => plugin.detail);
}
