import { pypiPluginManifest } from "../manifest";
import type { HostedRepositoryCreatePlugin } from "@axis-repository/admin-ui/plugin-ui";
import { repositoryCreateStepsForConfig } from "@axis-repository/admin-ui/plugin-ui";

export const pypiHostedRepositoryCreatePlugin: HostedRepositoryCreatePlugin = {
  kind: "hosted",
  ecosystem: pypiPluginManifest.ecosystem,
  repositoryConfig: pypiPluginManifest.repositoryConfig,
  steps: repositoryCreateStepsForConfig(pypiPluginManifest.repositoryConfig),
  defaults: {
    name: "",
    visibility: "private",
    config: {},
    setup: {},
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
    kind: "hosted",
    visibility: state.visibility,
    config: {
      [pypiPluginManifest.repositoryConfig.namespace]: {},
    },
  }),
};
