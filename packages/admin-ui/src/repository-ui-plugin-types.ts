import type {
  PluginRepositoryConfigFieldManifest,
  PluginRepositoryConfigManifest,
  RepositoryPluginManifest,
} from "@axis-repository/core/plugin-manifests";
import type { ComponentType } from "react";
import type { CreateRepositoryInput } from "./api/client";
import type { Repository, RepositoryPlugin, RepositoryVisibility } from "./api/schemas";

export type RepositoryCreateStep = "plugin" | "basics" | "config" | "dependencies" | "review";

export interface RepositoryCreateWizardState {
  name: string;
  visibility: RepositoryVisibility;
  config: Record<string, string>;
  dependencies: Record<string, string>;
}

export interface RepositoryCreatePlugin {
  ecosystem: string;
  repositoryConfig: PluginRepositoryConfigManifest;
  steps: RepositoryCreateStep[];
  defaults: RepositoryCreateWizardState;
  validateStep(step: RepositoryCreateStep, state: RepositoryCreateWizardState): string[];
  buildCreateInput(state: RepositoryCreateWizardState): CreateRepositoryInput;
}

export interface RepositoryCreateFieldErrors {
  name?: string;
}

export type RepositoryCreatePluginOption =
  | {
      ecosystem: string;
      displayName: string;
      description: string;
      capabilities: string[];
      supported: true;
      plugin: RepositoryCreatePlugin;
    }
  | {
      ecosystem: string;
      displayName: string;
      description: string;
      capabilities: string[];
      supported: false;
    };

export interface RepositoryDetailSectionProps {
  repository: Repository;
  pluginMetadata: RepositoryPlugin | undefined;
}

export interface RepositoryDetailSection {
  id: string;
  title: string;
  Component: ComponentType<RepositoryDetailSectionProps>;
}

export interface RepositoryDetailPlugin {
  ecosystem: string;
  sections: RepositoryDetailSection[];
}

export interface RepositoryCreateFieldRendererProps {
  field: PluginRepositoryConfigFieldManifest;
  repositoryName: string;
  value: string;
  onChange: (value: string) => void;
}

export type RepositoryCreateFieldRenderer = ComponentType<RepositoryCreateFieldRendererProps>;
export type RepositoryCreateFieldRendererMap = Record<string, RepositoryCreateFieldRenderer>;

export interface RepositoryUiPlugin {
  manifest: RepositoryPluginManifest;
  create: RepositoryCreatePlugin;
  detail: RepositoryDetailPlugin;
  createFieldRenderers?: RepositoryCreateFieldRendererMap;
  mapCreateServerError?: (message: string) => RepositoryCreateStep | undefined;
}
