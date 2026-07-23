import { pypiPluginManifest } from "@axis-repository/core/plugin-manifests";
import type { RepositoryDetailPlugin } from "../../repository-detail-plugins";
import type { RepositoryUiPlugin } from "../../repository-ui-plugins";
import { PublishSessionsSection, RepositoryClientHelpersSection } from "../../repository-detail-shared";
import { pypiRepositoryCreatePlugin } from "./create";
import {
  PypiInstallHintsSection,
  PypiSettingsSection,
} from "./detail";

export const pypiRepositoryDetailPlugin: RepositoryDetailPlugin = {
  ecosystem: pypiPluginManifest.ecosystem,
  displayName: pypiPluginManifest.displayName,
  sections: [
    { id: "settings", title: "PyPI settings", Component: PypiSettingsSection },
    { id: "publish-sessions", title: "Publish sessions", Component: PublishSessionsSection },
    { id: "client-helpers", title: "PyPI client setup", Component: RepositoryClientHelpersSection },
    { id: "install-hints", title: "Install hints", Component: PypiInstallHintsSection },
  ],
};

export const pypiRepositoryUiPlugin: RepositoryUiPlugin = {
  ecosystem: pypiPluginManifest.ecosystem,
  displayName: pypiPluginManifest.displayName,
  create: pypiRepositoryCreatePlugin,
  detail: pypiRepositoryDetailPlugin,
};
