import { pypiPluginManifest } from "../manifest";
import type { RepositoryCreatePlugin } from "../../../packages/admin-ui/src/repository-ui-plugin-types";
import { repositoryCreateStepsForConfig } from "../../../packages/admin-ui/src/repository-create-steps";

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
