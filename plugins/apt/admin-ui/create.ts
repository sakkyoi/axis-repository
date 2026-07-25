import type { PluginRepositoryConfigFieldManifest } from "@axis-repository/core/plugin-manifests";
import { aptPluginManifest } from "../manifest";
import type {
  RepositoryCreatePlugin,
  RepositoryCreateWizardState,
} from "@axis-repository/admin-ui/plugin-ui";
import { repositoryCreateStepsForConfig } from "@axis-repository/admin-ui/plugin-ui";
import { buildCreateAptRepositoryInput, type AptRepositoryFormValues } from "./forms";

function field(name: string): PluginRepositoryConfigFieldManifest {
  const configField = aptPluginManifest.repositoryConfig.fields.find((candidate) => candidate.name === name);
  if (!configField) {
    throw new Error(`APT repository config field is not declared: ${name}`);
  }
  return configField;
}

function stringDefault(name: string): string {
  const defaultValue = field(name).defaultValue;
  return typeof defaultValue === "string" ? defaultValue : "";
}

function requiredFieldError(name: string): string {
  return `${field(name).label} is required`;
}

function validateRequiredTextField(state: RepositoryCreateWizardState, name: string): string[] {
  const configField = field(name);
  if (!configField.required) return [];
  return state.config[name]?.trim() ? [] : [requiredFieldError(name)];
}

function validateRequiredDependencyField(state: RepositoryCreateWizardState, name: string): string[] {
  const configField = field(name);
  if (!configField.required) return [];
  return state.dependencies[name]?.trim() ? [] : [requiredFieldError(name)];
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
  ecosystem: aptPluginManifest.ecosystem,
  repositoryConfig: aptPluginManifest.repositoryConfig,
  steps: repositoryCreateStepsForConfig(aptPluginManifest.repositoryConfig),
  defaults: {
    name: "",
    visibility: "private",
    config: {
      codename: stringDefault("codename"),
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
      return validateRequiredTextField(state, "codename");
    }
    if (step === "dependencies") {
      return validateRequiredDependencyField(state, "signingKeyId");
    }
    return [];
  },
  buildCreateInput: (state) => buildCreateAptRepositoryInput(aptFormValues(state)),
};
