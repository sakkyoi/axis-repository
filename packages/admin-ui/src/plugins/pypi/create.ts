import { pypiPluginManifest } from "@axis-repository/core/plugin-manifests";
import type { RepositoryCreatePlugin } from "../../repository-create-plugins";

export const pypiRepositoryCreatePlugin: RepositoryCreatePlugin = {
  ecosystem: pypiPluginManifest.ecosystem,
  displayName: pypiPluginManifest.displayName,
  description: pypiPluginManifest.description,
  capabilities: [...pypiPluginManifest.capabilities],
  steps: ["plugin", "basics", "review"],
  defaults: {
    name: "",
    visibility: "private",
    config: {},
    dependencies: {},
  },
  validateStep: (step, state) => {
    if (step === "basics") {
      return state.name.trim() ? [] : ["Repository name is required"];
    }
    return [];
  },
  buildCreateInput: (state) => ({
    name: state.name,
    ecosystem: pypiPluginManifest.ecosystem,
    visibility: state.visibility,
    config: {
      pypi: {},
    },
  }),
};
