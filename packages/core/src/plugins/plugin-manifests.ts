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

export type PluginAdminResourceResponseKind = "json" | "text";

export interface PluginAdminResourceRouteManifest {
  name: string;
  method: "GET" | "POST" | "PATCH" | "DELETE" | (string & {});
  path: string[];
  responseKind: PluginAdminResourceResponseKind;
}

export interface PluginAdminResourcesManifest {
  namespace: string;
  routes: PluginAdminResourceRouteManifest[];
}

export type PluginRepositoryConfigFieldKind = "text" | "string-list" | "signing-key";
export type PluginRepositoryConfigDefaultValue = string | string[];
export type PluginRepositoryConfigFieldStep = "config" | "dependencies";

export interface PluginRepositoryConfigFieldManifest {
  name: string;
  label: string;
  kind: PluginRepositoryConfigFieldKind;
  step: PluginRepositoryConfigFieldStep;
  required: boolean;
  defaultValue?: PluginRepositoryConfigDefaultValue | undefined;
  placeholder?: string | undefined;
  description?: string | undefined;
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
  adminResources?: PluginAdminResourcesManifest;
}

export interface RepositoryPluginBundle {
  manifest: RepositoryPluginManifest;
  catalog: {
    enabled: boolean;
    experimental: boolean;
  };
  runtime: boolean;
  adminUi: boolean;
}
