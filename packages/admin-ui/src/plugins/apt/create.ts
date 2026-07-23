import { aptPluginManifest } from "@axis-repository/core/plugin-manifests";
import type { RepositoryCreatePlugin, RepositoryCreateWizardState } from "../../repository-create-plugins";
import { buildCreateAptRepositoryInput, type AptRepositoryFormValues } from "../../repository-forms";

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
  ecosystem: aptPluginManifest.ecosystem,
  displayName: aptPluginManifest.displayName,
  description: aptPluginManifest.description,
  capabilities: [...aptPluginManifest.capabilities],
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
