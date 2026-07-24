import type {
  PluginRepositoryConfigFieldManifest,
  PluginRepositoryConfigManifest,
  RepositoryPluginManifest,
} from "@axis-repository/core/plugin-manifests";
import type { ComponentType } from "react";
import type { CreateRepositoryInput } from "../../api/client";
import type { PublishSession, Repository, RepositoryPlugin, RepositoryVisibility } from "../../api/schemas";
import type { PluginLifecycleBadge, PluginLifecycleSummary } from "./plugin-lifecycle";

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
      lifecycle: PluginLifecycleSummary;
      badges: PluginLifecycleBadge[];
      supported: true;
      plugin: RepositoryCreatePlugin;
    }
  | {
      ecosystem: string;
      displayName: string;
      description: string;
      capabilities: string[];
      lifecycle: PluginLifecycleSummary;
      badges: PluginLifecycleBadge[];
      supported: false;
      disabledReason?: string;
    };

export interface RepositoryDetailSectionProps {
  repository: Repository;
  pluginMetadata: RepositoryPlugin | undefined;
}

export interface RepositoryDetailSection {
  id: string;
  title: string;
  placement: "workspace" | "settings";
  summary?: boolean;
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

export interface PublishTokenScopeInput {
  repositories: Repository[];
  selectedRepositories: string[];
  permissions: {
    read: boolean;
    publish: boolean;
  };
  signingKeySelections: Record<string, string>;
}

export interface PublishTokenScopeComponentProps extends PublishTokenScopeInput {
  onSigningKeySelectionChange: (repositoryName: string, signingKeyId: string) => void;
}

export interface PublishTokenScopeExtension {
  Component: ComponentType<PublishTokenScopeComponentProps>;
  missingSelections(input: PublishTokenScopeInput): string[];
}

export interface PublishSessionDetailComponentProps {
  session: PublishSession;
  artifactSummary: (session: PublishSession) => string;
}

export interface RepositoryPublishPlugin {
  ecosystem: string;
  FormComponent?: ComponentType<RepositoryDetailSectionProps>;
  SessionDetailComponent?: ComponentType<PublishSessionDetailComponentProps>;
  artifactSummary(session: PublishSession): string;
}

export interface RepositoryUiPlugin {
  manifest: RepositoryPluginManifest;
  create: RepositoryCreatePlugin;
  detail: RepositoryDetailPlugin;
  publish?: RepositoryPublishPlugin;
  createFieldRenderers?: RepositoryCreateFieldRendererMap;
  publishTokenScope?: PublishTokenScopeExtension;
  mapCreateServerError?: (message: string) => RepositoryCreateStep | undefined;
}
