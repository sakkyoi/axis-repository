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

export type PluginRepositoryConfigFieldKind = "text" | "string-list" | "signing-key" | "signing-key-provisioning";
export type PluginRepositoryConfigDefaultValue = string | string[];
export type PluginRepositoryConfigFieldStep = "config" | "setup";

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

export type PluginIconShape =
  | { kind: "path"; d: string; fill?: string; stroke?: string; strokeWidth?: number }
  | { kind: "circle"; cx: number; cy: number; r: number; fill?: string; stroke?: string; strokeWidth?: number }
  | {
    kind: "rect";
    x: number;
    y: number;
    width: number;
    height: number;
    rx?: number;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
  };

export interface PluginIconManifest {
  title: string;
  accentColor: string;
  viewBox?: string | undefined;
  shapes?: PluginIconShape[] | undefined;
  svg?: string | undefined;
  svgSource?: {
    name: string;
    url: string;
    rights: string;
  } | undefined;
}

export interface ResolvedPluginIconAssets {
  title: string;
  accentColor: string;
  inlineSvg: string;
}

export interface RepositoryPluginManifest {
  ecosystem: "apt" | "pypi" | (string & {});
  displayName: string;
  description: string;
  runtimeName: string;
  version: string;
  capabilities: string[];
  icon?: PluginIconManifest | undefined;
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
