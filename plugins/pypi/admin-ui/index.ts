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
  PypiGroupSettingsSection,
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
    {
      name: "upstreamUrlMode",
      label: "Upstream URL mode",
      kind: "select",
      step: "config",
      required: true,
      defaultValue: "base-url",
      placeholder: "base-url",
      description: "Use base-url for services like pypi.org, or simple-api-root when the URL already serves the Simple API.",
      options: [
        { value: "base-url", label: "Base URL" },
        { value: "simple-api-root", label: "Simple API root" },
      ],
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
    config: { upstreamUrl: "", upstreamUrlMode: "base-url" },
    setup: {},
  },
  validateStep: (step, state) => {
    if (step === "basics") {
      return state.name.trim() ? [] : ["Repository name is required"];
    }
    if (step === "config" && !state.config.upstreamUrl?.trim()) {
      return ["Upstream URL is required"];
    }
    if (step === "config" && !isPypiProxyUpstreamUrlMode(state.config.upstreamUrlMode)) {
      return ["Upstream URL mode is required"];
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
        upstreamUrl: normalizePypiProxyUpstreamUrl(state.config.upstreamUrl?.trim() ?? ""),
        upstreamUrlMode: state.config.upstreamUrlMode,
      },
    },
  }),
};

function isPypiProxyUpstreamUrlMode(value: unknown): value is "base-url" | "simple-api-root" {
  return value === "base-url" || value === "simple-api-root";
}

function normalizePypiProxyUpstreamUrl(value: string): string {
  if (!value) {
    return value;
  }
  const withScheme = /^[a-z][a-z\d+.-]*:/iu.test(value) ? value : `https://${value}`;
  return withScheme.endsWith("/") ? withScheme : `${withScheme}/`;
}

const pypiGroupRepositoryCreatePlugin: GroupRepositoryCreatePlugin = {
  kind: "group",
  ecosystem: pypiPluginManifest.ecosystem,
  repositoryConfig: {
    namespace: pypiPluginManifest.repositoryConfig.namespace,
    fields: [
      {
        name: "members",
        label: "Members",
        kind: "string-list",
        step: "config",
        required: true,
        placeholder: "python-hosted, python-proxy",
        description: "PyPI hosted or proxy repositories, in resolution order.",
      },
    ],
  },
  steps: ["plugin", "basics", "config", "review"],
  defaults: {
    name: "",
    visibility: "private",
    config: { members: "" },
    setup: {},
  },
  validateStep: (step, state) => {
    if (step === "basics") {
      return state.name.trim() ? [] : ["Repository name is required"];
    }
    if (step === "config" && parseStringList(state.config.members).length === 0) {
      return ["At least one member repository is required"];
    }
    return [];
  },
  buildCreateInput: (state) => ({
    name: state.name,
    ecosystem: pypiPluginManifest.ecosystem,
    kind: "group",
    visibility: state.visibility,
    config: {
      [pypiPluginManifest.repositoryConfig.namespace]: {
        members: parseStringList(state.config.members),
      },
    },
  }),
};

function parseStringList(value: string | undefined): string[] {
  return [...new Set((value ?? "")
    .split(/[\n,]/u)
    .map((entry) => entry.trim())
    .filter(Boolean))];
}

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
    { id: "install-hints", title: "Install hints", placement: "workspace", summary: true, Component: PypiInstallHintsSection },
    { id: "group-settings", title: "PyPI group members", placement: "settings", Component: PypiGroupSettingsSection },
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
