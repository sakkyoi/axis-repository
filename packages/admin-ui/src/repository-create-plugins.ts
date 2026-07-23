import type { CreateRepositoryInput } from "./api/client";
import type { RepositoryPlugin, RepositoryVisibility } from "./api/schemas";
import { aptRepositoryCreatePlugin } from "./plugins/apt/create";
import { pypiRepositoryCreatePlugin } from "./plugins/pypi/create";

export type RepositoryCreateStep = "plugin" | "basics" | "config" | "dependencies" | "review";

export interface RepositoryCreateWizardState {
  name: string;
  visibility: RepositoryVisibility;
  config: Record<string, string>;
  dependencies: Record<string, string>;
}

export interface RepositoryCreatePlugin {
  ecosystem: string;
  displayName: string;
  description: string;
  capabilities: string[];
  steps: RepositoryCreateStep[];
  defaults: RepositoryCreateWizardState;
  validateStep(step: RepositoryCreateStep, state: RepositoryCreateWizardState): string[];
  buildCreateInput(state: RepositoryCreateWizardState): CreateRepositoryInput;
}

export interface RepositoryCreateFieldErrors {
  name?: string;
}

export type RepositoryCreatePluginOption =
  | {
      ecosystem: string;
      displayName: string;
      description: string;
      capabilities: string[];
      supported: true;
      plugin: RepositoryCreatePlugin;
    }
  | {
      ecosystem: string;
      displayName: string;
      description: string;
      capabilities: string[];
      supported: false;
    };

export const repositoryCreatePlugins = [aptRepositoryCreatePlugin, pypiRepositoryCreatePlugin] as const;

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
  if (/^config\.apt\.|Codename|Components|Architectures/i.test(message)) {
    return plugin.steps.includes("config") ? "config" : undefined;
  }
  if (/Signing key/i.test(message)) {
    return plugin.steps.includes("dependencies") ? "dependencies" : undefined;
  }
  return undefined;
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
    const localPlugin = localPlugins.find((candidate) => candidate.ecosystem === serverPlugin.ecosystem);
    if (localPlugin) {
      return {
        ecosystem: serverPlugin.ecosystem,
        displayName: localPlugin.displayName,
        description: localPlugin.description,
        capabilities: [...serverPlugin.capabilities],
        supported: true,
        plugin: localPlugin,
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
