import { pypiInstallCommandText, pypiSimpleIndexUrl } from "./plugins/pypi/detail";
import {
  AdvancedJsonConfigSection,
  GenericRepositoryDetail,
  PublishSessionsSection,
  RepositorySettingsSection,
  repositoryClientHelperDisplayText,
} from "./repository-detail-shared";
import type { RepositoryDetailPlugin, RepositoryDetailSection } from "./repository-ui-plugin-types";
import { getRepositoryUiPlugin, repositoryDetailPluginsFromUiRegistry } from "./repository-ui-plugins";

export type { RepositoryDetailPlugin, RepositoryDetailSection, RepositoryDetailSectionProps } from "./repository-ui-plugin-types";

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
