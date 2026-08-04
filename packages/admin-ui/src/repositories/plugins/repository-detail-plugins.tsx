import {
  AdvancedJsonConfigSection,
  GenericRepositoryDetail,
  RepositorySettingsSection,
  repositoryClientHelperDisplayText,
} from "../detail/repository-detail-shared";
import type { Repository } from "../../api/schemas";
import { RepositoryBrowserSection } from "../browser/repository-browser-section";
import { RepositoryArtifactsSection } from "../artifacts/repository-artifacts-section";
import { RepositoryPublishSection } from "../publish/repository-publish-section";
import type { HostedRepositoryDetailPlugin, RepositoryDetailSection } from "./repository-ui-plugin-types";
import {
  getHostedRepositoryDetailPlugin as getHostedRepositoryDetailPluginFromRegistry,
  hostedRepositoryDetailPluginsFromUiRegistry,
} from "./repository-ui-plugins";

export type { HostedRepositoryDetailPlugin, RepositoryDetailSection, RepositoryDetailSectionProps } from "./repository-ui-plugin-types";

export const hostedRepositoryDetailPlugins = hostedRepositoryDetailPluginsFromUiRegistry();
/** @deprecated Use hostedRepositoryDetailPlugins. */
export const repositoryDetailPlugins = hostedRepositoryDetailPlugins;

export const genericRepositoryDetailSections: RepositoryDetailSection[] = [
  { id: "settings", title: "Repository settings", placement: "settings", Component: RepositorySettingsSection },
  { id: "repository-artifacts", title: "Artifacts", placement: "workspace", Component: RepositoryArtifactsSection },
  { id: "repository-browser", title: "Repository contents", placement: "workspace", Component: RepositoryBrowserSection },
  { id: "advanced-json", title: "Advanced JSON config", placement: "settings", Component: AdvancedJsonConfigSection },
];

export function getHostedRepositoryDetailPlugin(ecosystem: string): HostedRepositoryDetailPlugin | undefined {
  const plugin = getHostedRepositoryDetailPluginFromRegistry(ecosystem);
  return plugin ? normalizeHostedRepositoryDetailPlugin(plugin) : undefined;
}

function repositoryDetailSectionsFor(repository: Repository): RepositoryDetailSection[] {
  if (repository.kind !== "hosted") return [];
  const sections = getHostedRepositoryDetailPlugin(repository.ecosystem)?.sections ?? genericRepositoryDetailSections;
  return normalizeRepositoryDetailSections(sections);
}

function normalizeHostedRepositoryDetailPlugin(plugin: HostedRepositoryDetailPlugin): HostedRepositoryDetailPlugin {
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
  const hasArtifactsSection = normalizedSections.some((section) => section.id === "repository-artifacts");
  const hasBrowserSection = normalizedSections.some((section) => section.id === "repository-browser");
  if (hasArtifactsSection && hasBrowserSection) return normalizedSections;
  const artifactsSection: RepositoryDetailSection = {
    id: "repository-artifacts",
    title: "Artifacts",
    placement: "workspace",
    Component: RepositoryArtifactsSection,
  };
  const browserSection: RepositoryDetailSection = {
    id: "repository-browser",
    title: "Repository contents",
    placement: "workspace",
    Component: RepositoryBrowserSection,
  };
  return [
    ...(hasArtifactsSection ? [] : [artifactsSection]),
    ...(hasBrowserSection ? [] : [browserSection]),
    ...normalizedSections,
  ];
}

export function repositoryWorkspaceSectionsFor(repository: Repository): RepositoryDetailSection[] {
  return repositoryDetailSectionsFor(repository).filter((section) => section.placement === "workspace");
}

export function repositorySummarySectionsFor(repository: Repository): RepositoryDetailSection[] {
  return repositoryDetailSectionsFor(repository).filter((section) => section.summary === true);
}

export function repositorySettingsSectionsFor(repository: Repository): RepositoryDetailSection[] {
  return repositoryDetailSectionsFor(repository).filter((section) => section.placement === "settings");
}

export {
  GenericRepositoryDetail,
  RepositoryPublishSection,
  repositoryClientHelperDisplayText,
};
