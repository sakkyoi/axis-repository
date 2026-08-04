import type {
  PluginRepositoryConfigFieldManifest,
  PluginRepositoryConfigManifest,
  RepositoryPluginManifest,
} from "@axis-repository/core/plugin-manifests";
import type { ComponentType } from "react";
import type { CreateRepositoryInput } from "../../api/client";
import type { PublishSession, Repository, RepositoryPlugin, RepositoryVisibility } from "../../api/schemas";
import type { PluginLifecycleBadge, PluginLifecycleSummary } from "./plugin-lifecycle";

export type RepositoryCreateStep = "plugin" | "basics" | "config" | "setup" | "review";

export interface RepositoryCreateWizardState {
  name: string;
  visibility: RepositoryVisibility;
  config: Record<string, string>;
  setup: Record<string, string>;
}

export interface HostedRepositoryCreatePlugin {
  ecosystem: string;
  repositoryConfig: PluginRepositoryConfigManifest;
  steps: RepositoryCreateStep[];
  defaults: RepositoryCreateWizardState;
  validateStep(step: RepositoryCreateStep, state: RepositoryCreateWizardState): string[];
  buildCreateInput(state: RepositoryCreateWizardState): CreateRepositoryInput;
}

/** @deprecated Use HostedRepositoryCreatePlugin. */
export type RepositoryCreatePlugin = HostedRepositoryCreatePlugin;

export interface RepositoryCreateFieldErrors {
  name?: string;
}

export type HostedRepositoryCreatePluginOption =
  | {
      ecosystem: string;
      displayName: string;
      description: string;
      capabilities: string[];
      lifecycle: PluginLifecycleSummary;
      badges: PluginLifecycleBadge[];
      supported: true;
      plugin: HostedRepositoryCreatePlugin;
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

/** @deprecated Use HostedRepositoryCreatePluginOption. */
export type RepositoryCreatePluginOption = HostedRepositoryCreatePluginOption;

export interface RepositoryDetailSectionProps {
  repository: Repository;
  pluginMetadata: RepositoryPlugin | undefined;
  onPublishFiles?: (files: File[]) => void;
}

export interface RepositoryDetailSection {
  id: string;
  title: string;
  placement: "workspace" | "settings";
  summary?: boolean;
  Component: ComponentType<RepositoryDetailSectionProps>;
}

export interface HostedRepositoryDetailPlugin {
  ecosystem: string;
  sections: RepositoryDetailSection[];
}

/** @deprecated Use HostedRepositoryDetailPlugin. */
export type RepositoryDetailPlugin = HostedRepositoryDetailPlugin;

export interface RepositoryCreateFieldRendererProps {
  field: PluginRepositoryConfigFieldManifest;
  repositoryName: string;
  value: string;
  onChange: (value: string) => void;
  values: Record<string, string>;
  onValuesChange: (values: Record<string, string>) => void;
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
}

export interface PublishTokenScopeExtension {
  deriveSigningKeyIds(input: PublishTokenScopeInput): string[];
  missingRequiredScopes(input: PublishTokenScopeInput): string[];
}

export interface PublishSessionDetailComponentProps {
  session: PublishSession;
  artifactSummary: (session: PublishSession) => string;
}

export interface RepositoryPublishPreviewComponentProps extends RepositoryDetailSectionProps {
  droppedFiles: File[];
  onCancel: () => void;
  onPublished: () => void;
}

export interface HostedRepositoryPublishPlugin {
  ecosystem: string;
  title?: string;
  accept?: string;
  acceptedFileDescription?: string;
  isAcceptedFile?: (file: File) => boolean;
  PreviewComponent?: ComponentType<RepositoryPublishPreviewComponentProps>;
  SessionDetailComponent?: ComponentType<PublishSessionDetailComponentProps>;
  artifactSummary(session: PublishSession): string;
}

/** @deprecated Use HostedRepositoryPublishPlugin. */
export type RepositoryPublishPlugin = HostedRepositoryPublishPlugin;

export interface HostedRepositoryUiPlugin {
  manifest: RepositoryPluginManifest;
  create: HostedRepositoryCreatePlugin;
  detail: HostedRepositoryDetailPlugin;
  publish?: HostedRepositoryPublishPlugin;
  createFieldRenderers?: RepositoryCreateFieldRendererMap;
  publishTokenScope?: PublishTokenScopeExtension;
  mapCreateServerError?: (message: string) => RepositoryCreateStep | undefined;
}

/** @deprecated Use HostedRepositoryUiPlugin. */
export type RepositoryUiPlugin = HostedRepositoryUiPlugin;
