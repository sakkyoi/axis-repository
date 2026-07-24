import {
  AdvancedJsonConfigSection,
  GenericRepositoryDetail,
  PublishSessionsSection,
  RepositorySettingsSection,
  repositoryClientHelperDisplayText,
} from "./repository-detail-shared";
import type { RepositoryDetailPlugin, RepositoryDetailSection } from "./repository-ui-plugin-types";
import {
  getRepositoryDetailPlugin as getRepositoryDetailPluginFromRegistry,
  repositoryDetailPluginsFromUiRegistry,
} from "./repository-ui-plugins";

export type { RepositoryDetailPlugin, RepositoryDetailSection, RepositoryDetailSectionProps } from "./repository-ui-plugin-types";

export const repositoryDetailPlugins = repositoryDetailPluginsFromUiRegistry();

export const genericRepositoryDetailSections: RepositoryDetailSection[] = [
  { id: "settings", title: "Repository settings", placement: "settings", Component: RepositorySettingsSection },
  { id: "publish-sessions", title: "Publish sessions", placement: "workspace", Component: PublishSessionsSection },
  { id: "advanced-json", title: "Advanced JSON config", placement: "settings", Component: AdvancedJsonConfigSection },
];

export function getRepositoryDetailPlugin(ecosystem: string): RepositoryDetailPlugin | undefined {
  return getRepositoryDetailPluginFromRegistry(ecosystem);
}

function repositoryDetailSectionsFor(ecosystem: string): RepositoryDetailSection[] {
  return getRepositoryDetailPlugin(ecosystem)?.sections ?? genericRepositoryDetailSections;
}

export function repositoryWorkspaceSectionsFor(ecosystem: string): RepositoryDetailSection[] {
  return repositoryDetailSectionsFor(ecosystem).filter((section) => section.placement === "workspace");
}

export function repositorySettingsSectionsFor(ecosystem: string): RepositoryDetailSection[] {
  return repositoryDetailSectionsFor(ecosystem).filter((section) => section.placement === "settings");
}

export {
  GenericRepositoryDetail,
  repositoryClientHelperDisplayText,
};
