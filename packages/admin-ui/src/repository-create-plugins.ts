import type { CreateRepositoryInput } from "./api/client";
import type { RepositoryVisibility } from "./api/schemas";
import { buildCreateAptRepositoryInput, type AptRepositoryFormValues } from "./repository-forms";

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

function splitList(value: string): string[] {
  return value
    .split(/[\s,]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function aptFormValues(state: RepositoryCreateWizardState): AptRepositoryFormValues {
  return {
    name: state.name,
    visibility: state.visibility,
    codename: state.config.codename ?? "",
    components: state.config.components ?? "",
    architectures: state.config.architectures ?? "",
    signingKeyId: state.dependencies.signingKeyId ?? "",
  };
}

export const aptRepositoryCreatePlugin: RepositoryCreatePlugin = {
  ecosystem: "apt",
  displayName: "APT",
  description: "Debian package repositories with signed Release metadata.",
  capabilities: ["signed-release", "pool-copy", "serve:dists", "serve:pool"],
  steps: ["plugin", "basics", "config", "dependencies", "review"],
  defaults: {
    name: "",
    visibility: "private",
    config: {
      codename: "noble",
      components: "main",
      architectures: "amd64",
    },
    dependencies: {
      signingKeyId: "",
    },
  },
  validateStep: (step, state) => {
    if (step === "basics") {
      return state.name.trim() ? [] : ["Repository name is required"];
    }
    if (step === "config") {
      const errors: string[] = [];
      if (!state.config.codename?.trim()) errors.push("Codename is required");
      if (splitList(state.config.components ?? "").length === 0) errors.push("Components are required");
      if (splitList(state.config.architectures ?? "").length === 0) errors.push("Architectures are required");
      return errors;
    }
    if (step === "dependencies") {
      return state.dependencies.signingKeyId?.trim() ? [] : ["Signing key is required"];
    }
    return [];
  },
  buildCreateInput: (state) => buildCreateAptRepositoryInput(aptFormValues(state)),
};

export const repositoryCreatePlugins = [aptRepositoryCreatePlugin] as const;

export function getRepositoryCreatePlugin(ecosystem: string): RepositoryCreatePlugin {
  const plugin = repositoryCreatePlugins.find((candidate) => candidate.ecosystem === ecosystem);
  if (!plugin) {
    throw new Error(`Repository create plugin is not configured: ${ecosystem}`);
  }
  return plugin;
}
