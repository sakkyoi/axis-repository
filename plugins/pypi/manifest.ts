import type { RepositoryPluginManifest } from "../../packages/core/src/plugin-manifests";

export const pypiPluginManifest = {
  ecosystem: "pypi",
  displayName: "PyPI",
  description: "Python package repositories using the Simple Repository API.",
  runtimeName: "pypi-simple",
  version: "0.1.0",
  capabilities: ["pypi", "simple-api", "serve:simple", "client-helpers"],
  repositoryConfig: {
    namespace: "pypi",
    fields: [],
  },
  clientHelpers: {
    namespace: "pypi",
    actions: [
      {
        name: "simple-url",
        label: "Simple API URL",
        responseKind: "text",
        defaultOpen: true,
        public: true,
        displayPath: "simpleUrl",
      },
    ],
  },
} satisfies RepositoryPluginManifest;
