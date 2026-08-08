import { pypiPluginManifest } from "../manifest";
import type { PluginRepositoryConfigManifest } from "@axis-repository/core/plugin-manifests";
import type {
  GroupRepositoryCreatePlugin,
  GroupRepositoryDetailPlugin,
  GroupRepositoryUiPlugin,
  HostedRepositoryDetailPlugin,
  HostedRepositoryUiPlugin,
  ProxyRepositoryCreatePlugin,
  ProxyRepositoryDetailPlugin,
  ProxyRepositoryUiPlugin,
} from "@axis-repository/admin-ui/plugin-ui";
import { AdvancedJsonConfigSection, RepositoryClientHelpersSection } from "@axis-repository/admin-ui/plugin-ui";
import { pypiHostedRepositoryCreatePlugin } from "./create";
import {
  PypiInstallHintsSection,
  PypiUploadHintsSection,
  PypiProjectFilesSection,
  PypiProxySettingsSection,
} from "./detail";
import { repositoryCreateStepsForConfig } from "@axis-repository/admin-ui/plugin-ui";
import { PypiPublishArtifactPreview, PypiPublishSessionDetail, pypiPublishSessionArtifactSummary } from "./publish";
import { pypiIsAcceptedFile } from "./publish-model";

export const pypiHostedRepositoryDetailPlugin: HostedRepositoryDetailPlugin = {
  kind: "hosted",
  ecosystem: pypiPluginManifest.ecosystem,
  sections: [
    { id: "client-helpers", title: "PyPI client setup", placement: "workspace", Component: RepositoryClientHelpersSection },
    { id: "install-hints", title: "Install hints", placement: "workspace", summary: true, Component: PypiInstallHintsSection },
    { id: "upload-hints", title: "Upload hints", placement: "workspace", Component: PypiUploadHintsSection },
    { id: "project-files", title: "Published files", placement: "workspace", Component: PypiProjectFilesSection },
  ],
};

export const pypiHostedRepositoryUiPlugin: HostedRepositoryUiPlugin = {
  kind: "hosted",
  manifest: pypiPluginManifest,
  create: pypiHostedRepositoryCreatePlugin,
  detail: pypiHostedRepositoryDetailPlugin,
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

const pypiProxyRepositoryConfig: PluginRepositoryConfigManifest = {
  namespace: pypiPluginManifest.repositoryConfig.namespace,
  fields: [
    {
      name: "upstreamUrl",
      label: "Upstream URL",
      kind: "text",
      step: "config",
      required: true,
      placeholder: "https://pypi.org/",
      description: "The PyPI-compatible upstream base URL this proxy reads from.",
    },
  ],
};

const pypiProxyRepositoryCreatePlugin: ProxyRepositoryCreatePlugin = {
  kind: "proxy",
  ecosystem: pypiPluginManifest.ecosystem,
  repositoryConfig: pypiProxyRepositoryConfig,
  steps: repositoryCreateStepsForConfig(pypiProxyRepositoryConfig),
  defaults: {
    name: "",
    visibility: "private",
    config: { upstreamUrl: "" },
    setup: {},
  },
  validateStep: (step, state) => {
    if (step === "basics") {
      return state.name.trim() ? [] : ["Repository name is required"];
    }
    if (step === "config" && !state.config.upstreamUrl?.trim()) {
      return ["Upstream URL is required"];
    }
    return [];
  },
  buildCreateInput: (state) => ({
    name: state.name,
    ecosystem: pypiPluginManifest.ecosystem,
    kind: "proxy",
    visibility: state.visibility,
    config: {
      [pypiPluginManifest.repositoryConfig.namespace]: {
        upstreamUrl: state.config.upstreamUrl?.trim() ?? "",
      },
    },
  }),
};

const pypiGroupRepositoryCreatePlugin: GroupRepositoryCreatePlugin = {
  kind: "group",
  ecosystem: pypiPluginManifest.ecosystem,
  repositoryConfig: {
    namespace: pypiPluginManifest.repositoryConfig.namespace,
    fields: [],
  },
  steps: ["plugin", "basics", "review"],
  defaults: {
    name: "",
    visibility: "private",
    config: {},
    setup: {},
  },
  validateStep: (step, state) => {
    if (step === "basics") {
      return state.name.trim() ? [] : ["Repository name is required"];
    }
    return [];
  },
  buildCreateInput: (state) => ({
    name: state.name,
    ecosystem: pypiPluginManifest.ecosystem,
    kind: "group",
    visibility: state.visibility,
    config: {
      [pypiPluginManifest.repositoryConfig.namespace]: {},
    },
  }),
};

const pypiProxyRepositoryDetailPlugin: ProxyRepositoryDetailPlugin = {
  kind: "proxy",
  ecosystem: pypiPluginManifest.ecosystem,
  sections: [
    { id: "install-hints", title: "Install hints", placement: "workspace", summary: true, Component: PypiInstallHintsSection },
    { id: "proxy-settings", title: "PyPI proxy settings", placement: "settings", Component: PypiProxySettingsSection },
    { id: "advanced-json", title: "Advanced JSON config", placement: "settings", Component: AdvancedJsonConfigSection },
  ],
};

const pypiGroupRepositoryDetailPlugin: GroupRepositoryDetailPlugin = {
  kind: "group",
  ecosystem: pypiPluginManifest.ecosystem,
  sections: [
    { id: "advanced-json", title: "Advanced JSON config", placement: "settings", Component: AdvancedJsonConfigSection },
  ],
};

export const pypiProxyRepositoryUiPlugin: ProxyRepositoryUiPlugin = {
  kind: "proxy",
  manifest: pypiPluginManifest,
  create: pypiProxyRepositoryCreatePlugin,
  detail: pypiProxyRepositoryDetailPlugin,
};

export const pypiGroupRepositoryUiPlugin: GroupRepositoryUiPlugin = {
  kind: "group",
  manifest: pypiPluginManifest,
  create: pypiGroupRepositoryCreatePlugin,
  detail: pypiGroupRepositoryDetailPlugin,
};
