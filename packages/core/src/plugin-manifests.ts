export type PluginClientHelperResponseKind = "json" | "shell" | "text";

export interface PluginClientHelperActionManifest {
  name: string;
  label: string;
  responseKind: PluginClientHelperResponseKind;
  defaultOpen: boolean;
  public: boolean;
  displayPath?: string | undefined;
}

export interface PluginClientHelpersManifest {
  namespace: string;
  actions: PluginClientHelperActionManifest[];
}

export type PluginRepositoryConfigFieldKind = "text" | "string-list" | "signing-key";
export type PluginRepositoryConfigDefaultValue = string | string[];

export interface PluginRepositoryConfigFieldManifest {
  name: string;
  label: string;
  kind: PluginRepositoryConfigFieldKind;
  required: boolean;
  defaultValue?: PluginRepositoryConfigDefaultValue | undefined;
}

export interface PluginRepositoryConfigManifest {
  namespace: string;
  fields: PluginRepositoryConfigFieldManifest[];
}

export interface RepositoryPluginManifest {
  ecosystem: "apt" | "pypi" | (string & {});
  displayName: string;
  description: string;
  runtimeName: string;
  version: string;
  capabilities: string[];
  repositoryConfig: PluginRepositoryConfigManifest;
  clientHelpers?: PluginClientHelpersManifest;
}

export const aptPluginManifest = {
  ecosystem: "apt",
  displayName: "APT",
  description: "Debian package repositories with signed Release metadata.",
  runtimeName: "apt-signed",
  version: "0.1.0",
  capabilities: ["apt", "signed-release", "pool-copy", "serve:dists", "serve:pool"],
  repositoryConfig: {
    namespace: "apt",
    fields: [
      {
        name: "codename",
        label: "Codename",
        kind: "text",
        required: true,
        defaultValue: "noble",
      },
      {
        name: "components",
        label: "Components",
        kind: "string-list",
        required: true,
        defaultValue: ["main"],
      },
      {
        name: "architectures",
        label: "Architectures",
        kind: "string-list",
        required: true,
        defaultValue: ["amd64"],
      },
      {
        name: "signingKeyId",
        label: "Signing key",
        kind: "signing-key",
        required: true,
      },
    ],
  },
  clientHelpers: {
    namespace: "apt",
    actions: [
      {
        name: "key.gpg",
        label: "key.gpg",
        responseKind: "text",
        defaultOpen: false,
        public: true,
      },
      {
        name: "source",
        label: "source",
        responseKind: "json",
        defaultOpen: false,
        public: true,
      },
      {
        name: "install",
        label: "install",
        responseKind: "shell",
        defaultOpen: true,
        public: true,
      },
    ],
  },
} satisfies RepositoryPluginManifest;

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
