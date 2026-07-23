import type { ComponentType } from "react";
import { aptPluginManifest, pypiPluginManifest } from "@axis-repository/core/plugin-manifests";
import type { Repository, RepositoryPlugin } from "./api/schemas";
import { AptClientHelpersSection, AptSettingsSection, AptSigningKeysSection } from "./plugins/apt/detail";
import {
  PypiClientHelpersSection,
  PypiInstallHintsSection,
  PypiSettingsSection,
  pypiInstallCommandText,
  pypiSimpleIndexUrl,
} from "./plugins/pypi/detail";
import {
  AdvancedJsonConfigSection,
  GenericRepositoryDetail,
  RepositorySettingsSection,
  repositoryClientHelperDisplayText,
} from "./repository-detail-shared";

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

export const aptRepositoryDetailPlugin: RepositoryDetailPlugin = {
  ecosystem: aptPluginManifest.ecosystem,
  displayName: aptPluginManifest.displayName,
  sections: [
    { id: "settings", title: "APT settings", Component: AptSettingsSection },
    { id: "advanced-json", title: "Advanced JSON config", Component: AdvancedJsonConfigSection },
    { id: "signing-keys", title: "APT signing keys", Component: AptSigningKeysSection },
    { id: "client-helpers", title: "APT client setup", Component: AptClientHelpersSection },
  ],
};

export const pypiRepositoryDetailPlugin: RepositoryDetailPlugin = {
  ecosystem: pypiPluginManifest.ecosystem,
  displayName: pypiPluginManifest.displayName,
  sections: [
    { id: "settings", title: "PyPI settings", Component: PypiSettingsSection },
    { id: "client-helpers", title: "PyPI client setup", Component: PypiClientHelpersSection },
    { id: "install-hints", title: "Install hints", Component: PypiInstallHintsSection },
  ],
};

export const repositoryDetailPlugins = [aptRepositoryDetailPlugin, pypiRepositoryDetailPlugin] as const;

export const genericRepositoryDetailSections: RepositoryDetailSection[] = [
  { id: "settings", title: "Repository settings", Component: RepositorySettingsSection },
  { id: "advanced-json", title: "Advanced JSON config", Component: AdvancedJsonConfigSection },
];

export function getRepositoryDetailPlugin(ecosystem: string): RepositoryDetailPlugin | undefined {
  return repositoryDetailPlugins.find((plugin) => plugin.ecosystem === ecosystem);
}

export {
  GenericRepositoryDetail,
  pypiInstallCommandText,
  pypiSimpleIndexUrl,
  repositoryClientHelperDisplayText,
};
