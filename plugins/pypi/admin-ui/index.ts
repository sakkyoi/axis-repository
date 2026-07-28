import { pypiPluginManifest } from "../manifest";
import type {
  RepositoryDetailPlugin,
  RepositoryUiPlugin,
} from "@axis-repository/admin-ui/plugin-ui";
import { RepositoryClientHelpersSection } from "@axis-repository/admin-ui/plugin-ui";
import { pypiRepositoryCreatePlugin } from "./create";
import {
  PypiInstallHintsSection,
  PypiProjectFilesSection,
  PypiSettingsSection,
} from "./detail";
import { PypiPublishArtifactPreview, PypiPublishSessionDetail, pypiPublishSessionArtifactSummary } from "./publish";
import { pypiIsAcceptedFile } from "./publish-model";

export const pypiRepositoryDetailPlugin: RepositoryDetailPlugin = {
  ecosystem: pypiPluginManifest.ecosystem,
  sections: [
    { id: "settings", title: "PyPI settings", placement: "settings", Component: PypiSettingsSection },
    { id: "client-helpers", title: "PyPI client setup", placement: "workspace", Component: RepositoryClientHelpersSection },
    { id: "install-hints", title: "Install hints", placement: "workspace", summary: true, Component: PypiInstallHintsSection },
    { id: "project-files", title: "Published files", placement: "workspace", Component: PypiProjectFilesSection },
  ],
};

export const pypiRepositoryUiPlugin: RepositoryUiPlugin = {
  manifest: pypiPluginManifest,
  create: pypiRepositoryCreatePlugin,
  detail: pypiRepositoryDetailPlugin,
  publish: {
    ecosystem: pypiPluginManifest.ecosystem,
    title: "Publish Python distribution",
    accept: ".whl,.tar.gz",
    acceptedFileDescription: "Wheels (.whl) and source distributions (.tar.gz)",
    isAcceptedFile: pypiIsAcceptedFile,
    PreviewComponent: PypiPublishArtifactPreview,
    SessionDetailComponent: PypiPublishSessionDetail,
    artifactSummary: pypiPublishSessionArtifactSummary,
  },
};
