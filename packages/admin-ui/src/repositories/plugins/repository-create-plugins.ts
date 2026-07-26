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

