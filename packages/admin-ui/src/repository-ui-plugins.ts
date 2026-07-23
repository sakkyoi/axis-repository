import type { RepositoryPlugin } from "./api/schemas";
import type {
  RepositoryCreatePlugin,
  RepositoryCreatePluginOption,
  RepositoryDetailPlugin,
  RepositoryUiPlugin,
} from "./repository-ui-plugin-types";
import { aptRepositoryUiPlugin } from "./plugins/apt";
import { pypiRepositoryUiPlugin } from "./plugins/pypi";

type NonEmptyArray<T> = [T, ...T[]];

export const repositoryUiPlugins = [
  aptRepositoryUiPlugin,
  pypiRepositoryUiPlugin,
] satisfies NonEmptyArray<RepositoryUiPlugin>;

export function getRepositoryUiPlugin(ecosystem: string): RepositoryUiPlugin | undefined {
  return repositoryUiPlugins.find((plugin) => plugin.manifest.ecosystem === ecosystem);
}

export function repositoryCreatePluginsFromUiRegistry(): NonEmptyArray<RepositoryCreatePlugin> {
  return repositoryUiPlugins.map((plugin) => plugin.create) as NonEmptyArray<RepositoryCreatePlugin>;
}

export function repositoryDetailPluginsFromUiRegistry(): RepositoryDetailPlugin[] {
  return repositoryUiPlugins.map((plugin) => plugin.detail);
}

export function repositoryCreatePluginOptionsFromUiRegistry(
  serverPlugins: RepositoryPlugin[],
  localPlugins: readonly RepositoryUiPlugin[] = repositoryUiPlugins,
): RepositoryCreatePluginOption[] {
  return serverPlugins.map((serverPlugin) => {
    const localPlugin = localPlugins.find((candidate) => candidate.manifest.ecosystem === serverPlugin.ecosystem);
    if (localPlugin) {
      return {
        ecosystem: serverPlugin.ecosystem,
        displayName: localPlugin.manifest.displayName,
        description: localPlugin.manifest.description,
        capabilities: [...serverPlugin.capabilities],
        supported: true,
        plugin: localPlugin.create,
      };
    }
    return {
      ecosystem: serverPlugin.ecosystem,
      displayName: serverPlugin.ecosystem,
      description: "Server plugin is enabled, but this admin UI cannot create it yet.",
      capabilities: [...serverPlugin.capabilities],
      supported: false,
    };
  });
}
