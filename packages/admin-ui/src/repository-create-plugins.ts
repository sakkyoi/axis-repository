import type { RepositoryPlugin } from "./api/schemas";
import type {
  RepositoryCreateFieldErrors,
  RepositoryCreatePlugin,
  RepositoryCreatePluginOption,
  RepositoryCreateStep,
} from "./repository-ui-plugin-types";
import { pluginLifecycleBadges, pluginLifecycleSummary } from "./plugin-lifecycle";
import {
  getRepositoryCreateServerErrorMapper,
  getRepositoryPluginManifest,
  repositoryCreatePluginsFromUiRegistry,
} from "./repository-ui-plugins";

export type {
  RepositoryCreateFieldErrors,
  RepositoryCreatePlugin,
  RepositoryCreatePluginOption,
  RepositoryCreateStep,
  RepositoryCreateWizardState,
} from "./repository-ui-plugin-types";

export const repositoryCreatePlugins = repositoryCreatePluginsFromUiRegistry();
export { repositoryCreateStepsForConfig } from "./repository-create-steps";

export function getRepositoryCreatePlugin(ecosystem: string): RepositoryCreatePlugin {
  const plugin = repositoryCreatePlugins.find((candidate) => candidate.ecosystem === ecosystem);
  if (!plugin) {
    throw new Error(`Repository create plugin is not configured: ${ecosystem}`);
  }
  return plugin;
}

export function repositoryCreateStepForServerError(
  message: string,
  plugin: RepositoryCreatePlugin,
): RepositoryCreateStep | undefined {
  if (/^Repository already exists: /i.test(message) || message === "Repository name is required") {
    return plugin.steps.includes("basics") ? "basics" : undefined;
  }
  const pluginStep = getRepositoryCreateServerErrorMapper(plugin.ecosystem)?.(message);
  return pluginStep && plugin.steps.includes(pluginStep) ? pluginStep : undefined;
}

export function repositoryCreateFieldErrors(message: string): RepositoryCreateFieldErrors {
  if (/^Repository already exists: /i.test(message) || message === "Repository name is required") {
    return { name: message };
  }
  return {};
}

export function repositoryCreateAvailabilityError(
  repositoryName: string,
  existingRepositoryNames: readonly string[],
): string | undefined {
  const name = repositoryName.trim();
  if (!name) return "Repository name is required";
  return existingRepositoryNames.includes(name) ? `Repository already exists: ${name}` : undefined;
}

export function repositoryCreatePluginOptions(
  serverPlugins: RepositoryPlugin[],
  localPlugins: readonly RepositoryCreatePlugin[] = repositoryCreatePlugins,
): RepositoryCreatePluginOption[] {
  return serverPlugins.map((serverPlugin) => {
    const localPlugin = localPlugins.find((plugin) => plugin.ecosystem === serverPlugin.ecosystem);
    const manifest = getRepositoryPluginManifest(serverPlugin.ecosystem);
    const lifecycle = pluginLifecycleSummary(serverPlugin);
    const badges = pluginLifecycleBadges(serverPlugin);
    if (serverPlugin.enabled === false) {
      return {
        ecosystem: serverPlugin.ecosystem,
        displayName: manifest?.displayName ?? serverPlugin.ecosystem,
        description: "Server plugin is disabled.",
        capabilities: [...serverPlugin.capabilities],
        lifecycle,
        badges,
        supported: false,
      };
    }
    if (serverPlugin.runtime === false) {
      return {
        ecosystem: serverPlugin.ecosystem,
        displayName: manifest?.displayName ?? serverPlugin.ecosystem,
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
        displayName: serverPlugin.ecosystem,
        description: "Server plugin is enabled, but this admin UI cannot create it yet.",
        capabilities: [...serverPlugin.capabilities],
        lifecycle,
        badges,
        supported: false,
      };
    }
    return {
      ecosystem: serverPlugin.ecosystem,
      displayName: manifest?.displayName ?? serverPlugin.ecosystem,
      description: manifest?.description ?? "Repository plugin supported by this admin UI.",
      capabilities: [...serverPlugin.capabilities],
      lifecycle,
      badges,
      supported: true,
      plugin: localPlugin,
    };
  });
}
