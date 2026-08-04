import type { RepositoryPluginManifest } from "@axis-repository/core/plugin-manifests";
import type { Repository, RepositoryPlugin } from "../../api/schemas";
import {
  disabledPluginCreateDescription,
  pluginLifecycleBadges,
  pluginLifecycleSummary,
  pluginPolicyDescription,
} from "./plugin-lifecycle";
import type {
  PublishTokenScopeExtension,
  RepositoryCreatePluginDescriptor,
  RepositoryCreatePluginDescriptorOption,
  RepositoryCreateFieldRendererMap,
  HostedRepositoryCreatePlugin,
  RepositoryCreateStep,
  RepositoryDetailPluginDescriptor,
  HostedRepositoryDetailPlugin,
  HostedRepositoryPublishPlugin,
  HostedRepositoryUiPlugin,
  RepositoryUiPluginDescriptor,
} from "./repository-ui-plugin-types";
import { aptRepositoryPluginBundle } from "@axis-repository/plugin-apt";
import {
  aptGroupRepositoryUiPlugin,
  aptHostedRepositoryUiPlugin,
  aptProxyRepositoryUiPlugin,
} from "@axis-repository/plugin-apt/admin-ui";
import { pypiRepositoryPluginBundle } from "@axis-repository/plugin-pypi";
import {
  pypiGroupRepositoryUiPlugin,
  pypiHostedRepositoryUiPlugin,
  pypiProxyRepositoryUiPlugin,
} from "@axis-repository/plugin-pypi/admin-ui";

type NonEmptyArray<T> = [T, ...T[]];

const bundledAdminUiPlugins: Record<string, RepositoryUiPluginDescriptor> = {
  "hosted:apt": aptHostedRepositoryUiPlugin,
  "proxy:apt": aptProxyRepositoryUiPlugin,
  "group:apt": aptGroupRepositoryUiPlugin,
  "hosted:pypi": pypiHostedRepositoryUiPlugin,
  "proxy:pypi": pypiProxyRepositoryUiPlugin,
  "group:pypi": pypiGroupRepositoryUiPlugin,
};

function repositoryUiPluginKey(plugin: Pick<RepositoryUiPluginDescriptor, "kind" | "manifest">): string {
  return `${plugin.kind}:${plugin.manifest.ecosystem}`;
}

function repositoryKey(repository: Pick<Repository, "ecosystem" | "kind">): string {
  return `${repository.kind}:${repository.ecosystem}`;
}

export const hostedRepositoryUiPlugins = [aptRepositoryPluginBundle, pypiRepositoryPluginBundle]
  .filter((plugin) => plugin.catalog.enabled && plugin.adminUi)
  .map((plugin) => {
    const uiPlugin = bundledAdminUiPlugins[`hosted:${plugin.manifest.ecosystem}`];
    if (!uiPlugin) {
      throw new Error(`Admin UI plugin is not wired for ecosystem: ${plugin.manifest.ecosystem}`);
    }
    return uiPlugin;
  }) as NonEmptyArray<HostedRepositoryUiPlugin>;

export const repositoryUiPluginDescriptors = [aptRepositoryPluginBundle, pypiRepositoryPluginBundle]
  .filter((plugin) => plugin.catalog.enabled && plugin.adminUi)
  .flatMap((plugin) => (plugin.manifest.repositoryKinds ?? ["hosted"]).map((kind) => {
    const uiPlugin = bundledAdminUiPlugins[`${kind}:${plugin.manifest.ecosystem}`];
    if (!uiPlugin) {
      throw new Error(`Admin UI plugin is not wired for repository kind and ecosystem: ${kind} ${plugin.manifest.ecosystem}`);
    }
    return uiPlugin;
  })) as NonEmptyArray<RepositoryUiPluginDescriptor>;

const repositoryUiPluginByKindAndEcosystem = new Map<string, RepositoryUiPluginDescriptor>(
  repositoryUiPluginDescriptors.map((plugin) => [repositoryUiPluginKey(plugin), plugin]),
);

/** @deprecated Use hostedRepositoryUiPlugins. */
export const repositoryUiPlugins = hostedRepositoryUiPlugins;

function assertJsonEqual(label: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} does not match the shared plugin manifest`);
  }
}

export function assertRepositoryUiPluginContracts(plugins: readonly RepositoryUiPluginDescriptor[]): void {
  const pluginKeys = new Set<string>();
  for (const plugin of plugins) {
    const ecosystem = plugin.manifest.ecosystem;
    const pluginKey = repositoryUiPluginKey(plugin);
    if (pluginKeys.has(pluginKey)) {
      throw new Error(`Duplicate repository UI plugin kind and ecosystem: ${pluginKey}`);
    }
    pluginKeys.add(pluginKey);
    if (plugin.create.ecosystem !== ecosystem) {
      throw new Error(`Create UI plugin ecosystem does not match manifest: ${plugin.create.ecosystem}`);
    }
    if (plugin.detail.ecosystem !== ecosystem) {
      throw new Error(`Detail UI plugin ecosystem does not match manifest: ${plugin.detail.ecosystem}`);
    }
    if (plugin.kind === "hosted" && plugin.publish && plugin.publish.ecosystem !== ecosystem) {
      throw new Error(`Publish UI plugin ecosystem does not match manifest: ${plugin.publish.ecosystem}`);
    }
    if (!(plugin.manifest.repositoryKinds ?? ["hosted"]).includes(plugin.kind)) {
      throw new Error(`UI plugin kind does not match manifest repository kinds for ecosystem ${ecosystem}: ${plugin.kind}`);
    }
    if (plugin.kind === "hosted") {
      assertJsonEqual("Create UI repository config", plugin.create.repositoryConfig, plugin.manifest.repositoryConfig);
    }

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

/** @deprecated Use assertRepositoryUiPluginContracts. */
export function assertHostedRepositoryUiPluginContracts(plugins: readonly HostedRepositoryUiPlugin[]): void {
  assertRepositoryUiPluginContracts(plugins);
}

function getHostedRepositoryUiPlugin(ecosystem: string): HostedRepositoryUiPlugin | undefined {
  const plugin = repositoryUiPluginByKindAndEcosystem.get(`hosted:${ecosystem}`);
  return plugin?.kind === "hosted" ? plugin : undefined;
}

function getRepositoryUiPlugin(repository: Pick<Repository, "ecosystem" | "kind">): RepositoryUiPluginDescriptor | undefined {
  return repositoryUiPluginByKindAndEcosystem.get(repositoryKey(repository));
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

export function getRepositoryCreatePlugin(repository: Pick<Repository, "ecosystem" | "kind">): RepositoryCreatePluginDescriptor | undefined {
  return getRepositoryUiPlugin(repository)?.create;
}

export function getRepositoryDetailPlugin(repository: Pick<Repository, "ecosystem" | "kind">): RepositoryDetailPluginDescriptor | undefined {
  return getRepositoryUiPlugin(repository)?.detail;
}

export function getHostedRepositoryPublishPlugin(ecosystem: string): HostedRepositoryPublishPlugin | undefined {
  return getHostedRepositoryUiPlugin(ecosystem)?.publish;
}

export function getRepositoryPublishPlugin(repository: Pick<Repository, "ecosystem" | "kind">): HostedRepositoryPublishPlugin | undefined {
  const plugin = getRepositoryUiPlugin(repository);
  return plugin?.kind === "hosted" ? plugin.publish : undefined;
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

export function hostedRepositoryCreatePluginsFromUiRegistry(): NonEmptyArray<HostedRepositoryCreatePlugin> {
  return hostedRepositoryUiPlugins.map((plugin) => plugin.create) as NonEmptyArray<HostedRepositoryCreatePlugin>;
}

/** @deprecated Use hostedRepositoryCreatePluginsFromUiRegistry. */
export const repositoryCreatePluginsFromUiRegistry = hostedRepositoryCreatePluginsFromUiRegistry;

export function hostedRepositoryDetailPluginsFromUiRegistry(): HostedRepositoryDetailPlugin[] {
  return hostedRepositoryUiPlugins.map((plugin) => plugin.detail);
}

/** @deprecated Use hostedRepositoryDetailPluginsFromUiRegistry. */
export const repositoryDetailPluginsFromUiRegistry = hostedRepositoryDetailPluginsFromUiRegistry;

export function repositoryCreatePluginOptionsFromUiRegistry(
  serverPlugins: RepositoryPlugin[],
  localPlugins: readonly RepositoryUiPluginDescriptor[] = repositoryUiPluginDescriptors,
): RepositoryCreatePluginDescriptorOption[] {
  return serverPlugins.flatMap((serverPlugin) => {
    const lifecycle = pluginLifecycleSummary(serverPlugin);
    const badges = pluginLifecycleBadges(serverPlugin);
    const supportedKinds = serverPlugin.repositoryKinds.length > 0 ? serverPlugin.repositoryKinds : ["hosted" as const];
    return supportedKinds.map((kind) => {
      const localPlugin = localPlugins.find((candidate) =>
        candidate.kind === kind && candidate.manifest.ecosystem === serverPlugin.ecosystem,
      );
      if (serverPlugin.enabled === false) {
        return {
          ecosystem: serverPlugin.ecosystem,
          kind,
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
          kind,
          displayName: localPlugin?.manifest.displayName ?? serverPlugin.ecosystem,
          description: "Server plugin has no runtime support.",
          capabilities: [...serverPlugin.capabilities],
          lifecycle,
          badges,
          supported: false,
        };
      }
      if (!localPlugin) {
        return {
          ecosystem: serverPlugin.ecosystem,
          kind,
          displayName: serverPlugin.ecosystem,
          description: "No admin UI create adapter is registered for this plugin's repository kinds yet.",
          capabilities: [...serverPlugin.capabilities],
          lifecycle,
          badges,
          supported: false,
        };
      }
      return {
        ecosystem: serverPlugin.ecosystem,
        kind,
        displayName: localPlugin.manifest.displayName,
        description: localPlugin.manifest.description,
        capabilities: [...serverPlugin.capabilities],
        lifecycle,
        badges,
        supported: true,
        plugin: localPlugin.create,
      };
    });
  });
}
