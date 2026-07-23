import type { ComponentType } from "react";
import type { Repository, RepositoryPlugin } from "./api/schemas";
import { pypiInstallCommandText, pypiSimpleIndexUrl } from "./plugins/pypi/detail";
import {
  AdvancedJsonConfigSection,
  GenericRepositoryDetail,
  PublishSessionsSection,
  RepositorySettingsSection,
  repositoryClientHelperDisplayText,
} from "./repository-detail-shared";
import { getRepositoryUiPlugin, repositoryDetailPluginsFromUiRegistry } from "./repository-ui-plugins";

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
  displayName: string;
  sections: RepositoryDetailSection[];
}

export const repositoryDetailPlugins = repositoryDetailPluginsFromUiRegistry();

export const genericRepositoryDetailSections: RepositoryDetailSection[] = [
  { id: "settings", title: "Repository settings", Component: RepositorySettingsSection },
  { id: "publish-sessions", title: "Publish sessions", Component: PublishSessionsSection },
  { id: "advanced-json", title: "Advanced JSON config", Component: AdvancedJsonConfigSection },
];

export function getRepositoryDetailPlugin(ecosystem: string): RepositoryDetailPlugin | undefined {
  return getRepositoryUiPlugin(ecosystem)?.detail;
}

export {
  GenericRepositoryDetail,
  pypiInstallCommandText,
  pypiSimpleIndexUrl,
  repositoryClientHelperDisplayText,
};
