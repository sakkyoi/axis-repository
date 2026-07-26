import type {
  RepositoryCreateFieldErrors,
  RepositoryCreatePlugin,
  RepositoryCreateStep,
} from "./repository-ui-plugin-types";
import {
  getRepositoryCreateServerErrorMapper,
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
export { repositoryCreateStepsForConfig } from "../create/repository-create-steps";

/**
 * Server-side rejections of the repository name. These must route back to the
 * basics step and attach to the name field, or the wizard shows an unattached
 * banner on whichever step the user was on.
 */
function isRepositoryNameError(message: string): boolean {
  return /^Repository already exists: /i.test(message)
    || message === "Repository name is required"
    || message.startsWith("Repository name must ");
}

export function repositoryCreateStepForServerError(
  message: string,
  plugin: RepositoryCreatePlugin,
): RepositoryCreateStep | undefined {
  if (isRepositoryNameError(message)) {
    return plugin.steps.includes("basics") ? "basics" : undefined;
  }
  const pluginStep = getRepositoryCreateServerErrorMapper(plugin.ecosystem)?.(message);
  return pluginStep && plugin.steps.includes(pluginStep) ? pluginStep : undefined;
}

export function repositoryCreateFieldErrors(message: string): RepositoryCreateFieldErrors {
  if (isRepositoryNameError(message)) {
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

