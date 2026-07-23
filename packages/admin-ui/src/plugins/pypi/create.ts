import { pypiPluginManifest } from "@axis-repository/core/plugin-manifests";
import type { RepositoryCreatePlugin } from "../../repository-ui-plugin-types";
import { repositoryCreateStepsForConfig } from "../../repository-create-steps";

export const pypiRepositoryCreatePlugin: RepositoryCreatePlugin = {
  ecosystem: pypiPluginManifest.ecosystem,
  repositoryConfig: pypiPluginManifest.repositoryConfig,
  steps: repositoryCreateStepsForConfig(pypiPluginManifest.repositoryConfig),
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
      [pypiPluginManifest.repositoryConfig.namespace]: {},
    },
  }),
};
