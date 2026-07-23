import type { RepositoryPlugin } from "./api/schemas";
import type {
  RepositoryCreateFieldErrors,
  RepositoryCreatePlugin,
  RepositoryCreatePluginOption,
  RepositoryCreateStep,
} from "./repository-ui-plugin-types";
import {
  getRepositoryUiPlugin,
  repositoryCreatePluginOptionsFromUiRegistry,
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
  const pluginStep = getRepositoryUiPlugin(plugin.ecosystem)?.mapCreateServerError?.(message);
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
  const pluginEntries = localPlugins
    .map((plugin) => getRepositoryUiPlugin(plugin.ecosystem))
    .filter((plugin): plugin is NonNullable<typeof plugin> => Boolean(plugin));
  return repositoryCreatePluginOptionsFromUiRegistry(serverPlugins, pluginEntries);
}
