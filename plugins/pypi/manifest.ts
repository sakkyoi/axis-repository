import type { RepositoryPluginManifest } from "@axis-repository/core/plugin-manifests";

export const pypiPluginManifest = {
  ecosystem: "pypi",
  displayName: "PyPI",
  description: "Python package repositories using the Simple Repository API.",
  runtimeName: "pypi-simple",
  version: "0.1.0",
  capabilities: ["pypi", "simple-api", "serve:simple", "client-helpers"],
  icon: {
    title: "PyPI",
    viewBox: "0 0 24 24",
    accentColor: "#2563eb",
    shapes: [
      { kind: "rect", x: 4, y: 5, width: 16, height: 14, rx: 2, fill: "none", stroke: "currentColor", strokeWidth: 1.8 },
      { kind: "path", d: "M8 9h5.2a2.8 2.8 0 0 1 0 5.6H10V18H8V9Z", fill: "currentColor" },
    ],
  },
  repositoryConfig: {
    namespace: "pypi",
    fields: [],
  },
  adminResources: {
    namespace: "pypi",
    routes: [
      {
        name: "list-projects",
        method: "GET",
        path: ["projects"],
        responseKind: "json",
      },
      {
        name: "yank-file",
        method: "POST",
        path: ["projects", ":project", "files", ":filename", "yank"],
        responseKind: "json",
      },
      {
        name: "unyank-file",
        method: "POST",
        path: ["projects", ":project", "files", ":filename", "unyank"],
        responseKind: "json",
      },
    ],
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
      {
        name: "twine-config",
        label: "twine upload",
        responseKind: "text",
        defaultOpen: false,
        // Not public: a public action bypasses repository read authorization,
        // and only someone who can publish has any use for this.
        public: false,
        displayPath: "pypirc",
      },
    ],
  },
} satisfies RepositoryPluginManifest;
