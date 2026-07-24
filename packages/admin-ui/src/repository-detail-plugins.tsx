import {
  AdvancedJsonConfigSection,
  GenericRepositoryDetail,
  PublishSessionsSection,
  RepositorySettingsSection,
  repositoryClientHelperDisplayText,
} from "./repository-detail-shared";
import { RepositoryPublishSection } from "./repository-publish-section";
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
  const plugin = getRepositoryDetailPluginFromRegistry(ecosystem);
  return plugin ? normalizeRepositoryDetailPlugin(plugin) : undefined;
}

function repositoryDetailSectionsFor(ecosystem: string): RepositoryDetailSection[] {
  const sections = getRepositoryDetailPlugin(ecosystem)?.sections ?? genericRepositoryDetailSections;
  return normalizeRepositoryDetailSections(sections);
}

function normalizeRepositoryDetailPlugin(plugin: RepositoryDetailPlugin): RepositoryDetailPlugin {
  return {
    ...plugin,
    sections: normalizeRepositoryDetailSections(plugin.sections),
  };
}

function normalizeRepositoryDetailSections(sections: RepositoryDetailSection[]): RepositoryDetailSection[] {
  const normalizedSections = sections.map((section) =>
    section.id === "publish-sessions"
      ? { ...section, Component: RepositoryPublishSection }
      : section,
  );
  if (normalizedSections.some((section) => section.id === "publish-sessions")) {
    return normalizedSections;
  }
  const publishSection: RepositoryDetailSection = {
    id: "publish-sessions",
    title: "Publish sessions",
    placement: "workspace",
    Component: RepositoryPublishSection,
  };
  const insertAt = normalizedSections.length > 0 ? 1 : 0;
  return [
    ...normalizedSections.slice(0, insertAt),
    publishSection,
    ...normalizedSections.slice(insertAt),
  ];
}

export function repositoryWorkspaceSectionsFor(ecosystem: string): RepositoryDetailSection[] {
  return repositoryDetailSectionsFor(ecosystem).filter((section) => section.placement === "workspace");
}

export function repositorySummarySectionsFor(ecosystem: string): RepositoryDetailSection[] {
  return repositoryDetailSectionsFor(ecosystem).filter((section) => section.summary === true);
}

export function repositorySettingsSectionsFor(ecosystem: string): RepositoryDetailSection[] {
  return repositoryDetailSectionsFor(ecosystem).filter((section) => section.placement === "settings");
}

export {
  GenericRepositoryDetail,
  RepositoryPublishSection,
  repositoryClientHelperDisplayText,
};
