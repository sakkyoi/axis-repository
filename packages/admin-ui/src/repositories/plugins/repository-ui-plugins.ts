import type { RepositoryPluginManifest } from "@axis-repository/core/plugin-manifests";
import type { RepositoryPlugin } from "../../api/schemas";
import {
  disabledPluginCreateDescription,
  pluginLifecycleBadges,
  pluginLifecycleSummary,
  pluginPolicyDescription,
} from "./plugin-lifecycle";
import type {
  PublishTokenScopeExtension,
  RepositoryCreateFieldRendererMap,
  HostedRepositoryCreatePlugin,
  HostedRepositoryCreatePluginOption,
  RepositoryCreateStep,
  HostedRepositoryDetailPlugin,
  HostedRepositoryPublishPlugin,
  HostedRepositoryUiPlugin,
} from "./repository-ui-plugin-types";
import { aptRepositoryPluginBundle } from "@axis-repository/plugin-apt";
import { aptHostedRepositoryUiPlugin } from "@axis-repository/plugin-apt/admin-ui";
import { pypiRepositoryPluginBundle } from "@axis-repository/plugin-pypi";
import { pypiHostedRepositoryUiPlugin } from "@axis-repository/plugin-pypi/admin-ui";

type NonEmptyArray<T> = [T, ...T[]];

const bundledAdminUiPlugins: Record<string, HostedRepositoryUiPlugin> = {
  apt: aptHostedRepositoryUiPlugin,
  pypi: pypiHostedRepositoryUiPlugin,
};

export const repositoryUiPlugins = [aptRepositoryPluginBundle, pypiRepositoryPluginBundle]
  .filter((plugin) => plugin.catalog.enabled && plugin.adminUi)
  .map((plugin) => {
    const uiPlugin = bundledAdminUiPlugins[plugin.manifest.ecosystem];
    if (!uiPlugin) {
      throw new Error(`Admin UI plugin is not wired for ecosystem: ${plugin.manifest.ecosystem}`);
    }
    return uiPlugin;
  }) as NonEmptyArray<HostedRepositoryUiPlugin>;

function assertJsonEqual(label: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} does not match the shared plugin manifest`);
  }
}

export function assertHostedRepositoryUiPluginContracts(plugins: readonly HostedRepositoryUiPlugin[]): void {
  const ecosystems = new Set<string>();
  for (const plugin of plugins) {
    const ecosystem = plugin.manifest.ecosystem;
    if (ecosystems.has(ecosystem)) {
      throw new Error(`Duplicate repository UI plugin ecosystem: ${ecosystem}`);
    }
    ecosystems.add(ecosystem);
    if (plugin.create.ecosystem !== ecosystem) {
      throw new Error(`Create UI plugin ecosystem does not match manifest: ${plugin.create.ecosystem}`);
    }
    if (plugin.detail.ecosystem !== ecosystem) {
      throw new Error(`Detail UI plugin ecosystem does not match manifest: ${plugin.detail.ecosystem}`);
    }
    if (plugin.publish && plugin.publish.ecosystem !== ecosystem) {
      throw new Error(`Publish UI plugin ecosystem does not match manifest: ${plugin.publish.ecosystem}`);
    }
    assertJsonEqual("Create UI repository config", plugin.create.repositoryConfig, plugin.manifest.repositoryConfig);

    const sectionIds = new Set<string>();
    for (const section of plugin.detail.sections) {
      if (sectionIds.has(section.id)) {
        throw new Error(`Duplicate repository detail section id for ecosystem ${ecosystem}: ${section.id}`);
      }
      sectionIds.add(section.id);
    }

    for (const fieldKind of Object.keys(plugin.createFieldRenderers ?? {})) {
      if (!plugin.manifest.repositoryConfig.fields.some((field) => field.kind === fieldKind)) {
        throw new Error(`Create field renderer does not match a manifest field kind for ecosystem ${ecosystem}: ${fieldKind}`);
      }
    }
  }
}

function getHostedRepositoryUiPlugin(ecosystem: string): HostedRepositoryUiPlugin | undefined {
  return repositoryUiPlugins.find((plugin) => plugin.manifest.ecosystem === ecosystem);
}

export function getRepositoryPluginManifest(ecosystem: string): RepositoryPluginManifest | undefined {
  return getHostedRepositoryUiPlugin(ecosystem)?.manifest;
}

export function getHostedRepositoryCreatePlugin(ecosystem: string): HostedRepositoryCreatePlugin | undefined {
  return getHostedRepositoryUiPlugin(ecosystem)?.create;
}

export function getHostedRepositoryDetailPlugin(ecosystem: string): HostedRepositoryDetailPlugin | undefined {
  return getHostedRepositoryUiPlugin(ecosystem)?.detail;
}

export function getHostedRepositoryPublishPlugin(ecosystem: string): HostedRepositoryPublishPlugin | undefined {
  return getHostedRepositoryUiPlugin(ecosystem)?.publish;
}

export function getPublishTokenScopeExtension(ecosystem: string): PublishTokenScopeExtension | undefined {
  return getHostedRepositoryUiPlugin(ecosystem)?.publishTokenScope;
}

export function getRepositoryCreateFieldRenderers(ecosystem: string): RepositoryCreateFieldRendererMap | undefined {
  return getHostedRepositoryUiPlugin(ecosystem)?.createFieldRenderers;
}

export function getRepositoryCreateServerErrorMapper(
  ecosystem: string,
): ((message: string) => RepositoryCreateStep | undefined) | undefined {
  return getHostedRepositoryUiPlugin(ecosystem)?.mapCreateServerError;
}

export function repositoryCreatePluginsFromUiRegistry(): NonEmptyArray<HostedRepositoryCreatePlugin> {
  return repositoryUiPlugins.map((plugin) => plugin.create) as NonEmptyArray<HostedRepositoryCreatePlugin>;
}

export function repositoryDetailPluginsFromUiRegistry(): HostedRepositoryDetailPlugin[] {
  return repositoryUiPlugins.map((plugin) => plugin.detail);
}

export function repositoryCreatePluginOptionsFromUiRegistry(
  serverPlugins: RepositoryPlugin[],
  localPlugins: readonly HostedRepositoryUiPlugin[] = repositoryUiPlugins,
): HostedRepositoryCreatePluginOption[] {
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
