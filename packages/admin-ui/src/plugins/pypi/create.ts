import type { RepositoryCreatePlugin } from "../../repository-create-plugins";

export const pypiRepositoryCreatePlugin: RepositoryCreatePlugin = {
  ecosystem: "pypi",
  displayName: "PyPI",
  description: "Python package repositories using the Simple Repository API.",
  capabilities: ["simple-api", "serve:simple", "client-helpers"],
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
    ecosystem: "pypi",
    visibility: state.visibility,
    config: {
      pypi: {},
    },
  }),
};
