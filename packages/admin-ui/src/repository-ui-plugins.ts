import type { RepositoryPluginManifest } from "@axis-repository/core/plugin-manifests";
import type { RepositoryPlugin } from "./api/schemas";
import {
  disabledPluginCreateDescription,
  pluginLifecycleBadges,
  pluginLifecycleSummary,
  pluginPolicyDescription,
} from "./plugin-lifecycle";
import type {
  PublishTokenScopeExtension,
  RepositoryCreateFieldRendererMap,
  RepositoryCreatePlugin,
  RepositoryCreatePluginOption,
  RepositoryCreateStep,
  RepositoryDetailPlugin,
  RepositoryPublishPlugin,
  RepositoryUiPlugin,
} from "./repository-ui-plugin-types";
import { repositoryAdminUiPlugins } from "../../../plugins/admin-ui";

type NonEmptyArray<T> = [T, ...T[]];

export const repositoryUiPlugins = [
  ...repositoryAdminUiPlugins,
] satisfies NonEmptyArray<RepositoryUiPlugin>;

function getRepositoryUiPlugin(ecosystem: string): RepositoryUiPlugin | undefined {
  return repositoryUiPlugins.find((plugin) => plugin.manifest.ecosystem === ecosystem);
}

export function getRepositoryPluginManifest(ecosystem: string): RepositoryPluginManifest | undefined {
  return getRepositoryUiPlugin(ecosystem)?.manifest;
}

export function getRepositoryCreatePlugin(ecosystem: string): RepositoryCreatePlugin | undefined {
  return getRepositoryUiPlugin(ecosystem)?.create;
}

export function getRepositoryDetailPlugin(ecosystem: string): RepositoryDetailPlugin | undefined {
  return getRepositoryUiPlugin(ecosystem)?.detail;
}

export function getRepositoryPublishPlugin(ecosystem: string): RepositoryPublishPlugin | undefined {
  return getRepositoryUiPlugin(ecosystem)?.publish;
}

export function getPublishTokenScopeExtension(ecosystem: string): PublishTokenScopeExtension | undefined {
  return getRepositoryUiPlugin(ecosystem)?.publishTokenScope;
}

export function getRepositoryCreateFieldRenderers(ecosystem: string): RepositoryCreateFieldRendererMap | undefined {
  return getRepositoryUiPlugin(ecosystem)?.createFieldRenderers;
}

export function getRepositoryCreateServerErrorMapper(
  ecosystem: string,
): ((message: string) => RepositoryCreateStep | undefined) | undefined {
  return getRepositoryUiPlugin(ecosystem)?.mapCreateServerError;
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
    const lifecycle = pluginLifecycleSummary(serverPlugin);
    const badges = pluginLifecycleBadges(serverPlugin);
    if (serverPlugin.enabled === false) {
      return {
        ecosystem: serverPlugin.ecosystem,
        displayName: localPlugin?.manifest.displayName ?? serverPlugin.ecosystem,
        description: disabledPluginCreateDescription(serverPlugin),
        capabilities: [...serverPlugin.capabilities],
        disabledReason: pluginPolicyDescription(serverPlugin),
        lifecycle,
        badges,
        supported: false,
      };
    }
    if (serverPlugin.runtime === false) {
      return {
        ecosystem: serverPlugin.ecosystem,
        displayName: localPlugin?.manifest.displayName ?? serverPlugin.ecosystem,
        description: "Server plugin has no runtime support.",
        capabilities: [...serverPlugin.capabilities],
        lifecycle,
        badges,
        supported: false,
      };
    }
    if (localPlugin) {
      return {
        ecosystem: serverPlugin.ecosystem,
        displayName: localPlugin.manifest.displayName,
        description: localPlugin.manifest.description,
        capabilities: [...serverPlugin.capabilities],
        lifecycle,
        badges,
        supported: true,
        plugin: localPlugin.create,
      };
    }
    return {
      ecosystem: serverPlugin.ecosystem,
      displayName: serverPlugin.ecosystem,
      description: "Server plugin is enabled, but this admin UI cannot create it yet.",
      capabilities: [...serverPlugin.capabilities],
      lifecycle,
      badges,
      supported: false,
    };
  });
}
