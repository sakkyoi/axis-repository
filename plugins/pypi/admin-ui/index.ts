import { pypiPluginManifest } from "../manifest";
import type {
  RepositoryDetailPlugin,
  RepositoryUiPlugin,
} from "@axis-repository/admin-ui/plugin-ui";
import { RepositoryClientHelpersSection } from "@axis-repository/admin-ui/plugin-ui";
import { pypiRepositoryCreatePlugin } from "./create";
import {
  PypiInstallHintsSection,
  PypiSettingsSection,
} from "./detail";
import { PypiPublishSessionsSection, pypiPublishSessionArtifactSummary } from "./publish";

export const pypiRepositoryDetailPlugin: RepositoryDetailPlugin = {
  ecosystem: pypiPluginManifest.ecosystem,
  sections: [
    { id: "settings", title: "PyPI settings", Component: PypiSettingsSection },
    { id: "publish-sessions", title: "Publish sessions", Component: PypiPublishSessionsSection },
    { id: "client-helpers", title: "PyPI client setup", Component: RepositoryClientHelpersSection },
    { id: "install-hints", title: "Install hints", Component: PypiInstallHintsSection },
  ],
};

export const pypiRepositoryUiPlugin: RepositoryUiPlugin = {
  manifest: pypiPluginManifest,
  create: pypiRepositoryCreatePlugin,
  detail: pypiRepositoryDetailPlugin,
  publish: {
    ecosystem: pypiPluginManifest.ecosystem,
    Component: PypiPublishSessionsSection,
    artifactSummary: pypiPublishSessionArtifactSummary,
  },
};
