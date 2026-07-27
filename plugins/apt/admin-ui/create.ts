import type { PluginRepositoryConfigFieldManifest } from "@axis-repository/core/plugin-manifests";
import { aptPluginManifest } from "../manifest";
import type {
  RepositoryCreatePlugin,
  RepositoryCreateWizardState,
} from "@axis-repository/admin-ui/plugin-ui";
import { repositoryCreateStepsForConfig } from "@axis-repository/admin-ui/plugin-ui";
import { buildCreateAptRepositoryInput, emptyAptSettings, type AptRepositoryFormValues } from "./forms";

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

function aptFormValues(state: RepositoryCreateWizardState): AptRepositoryFormValues {
  return {
    ...emptyAptSettings,
    name: state.name,
    visibility: state.visibility,
    codename: state.config.codename ?? "",
    components: state.config.components ?? "",
    architectures: state.config.architectures ?? "",
    signingKeyMode: state.setup.signingKeyMode ?? "generate",
    signingKeyName: state.setup.signingKeyName ?? "",
    signingKeyUserIdName: state.setup.signingKeyUserIdName ?? "",
    signingKeyUserIdEmail: state.setup.signingKeyUserIdEmail ?? "",
    signingKeyPrivateKeyArmored: state.setup.signingKeyPrivateKeyArmored ?? "",
    signingKeyPassphrase: state.setup.signingKeyPassphrase ?? "",
    signingKeyExistingId: state.setup.signingKeyExistingId ?? "",
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
    setup: {
      signingKeyMode: "generate",
      signingKeyName: "release",
      signingKeyUserIdName: "Axis Repository",
      signingKeyUserIdEmail: "",
      signingKeyPrivateKeyArmored: "",
      signingKeyPassphrase: "",
      signingKeyExistingId: "",
    },
  },
  validateStep: (step, state) => {
    if (step === "basics") {
      return state.name.trim() ? [] : ["Repository name is required"];
    }
    if (step === "config") {
      return validateRequiredTextField(state, "codename");
    }
    if (step === "setup") {
      try {
        buildCreateAptRepositoryInput(aptFormValues(state));
        return [];
      } catch (error) {
        return [error instanceof Error ? error.message : requiredFieldError("signingKey")];
      }
    }
    return [];
  },
  buildCreateInput: (state) => buildCreateAptRepositoryInput(aptFormValues(state)),
};
