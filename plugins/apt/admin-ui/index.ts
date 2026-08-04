import { aptPluginManifest } from "../manifest";
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
import {
  AdvancedJsonConfigSection,
  RepositoryClientHelpersSection,
} from "@axis-repository/admin-ui/plugin-ui";
import { aptHostedRepositoryCreatePlugin } from "./create";
import { AptSigningKeySetupField } from "./create-field-renderers";
import { AptSettingsSection, AptSigningKeysSection } from "./detail";
import { AptPublishArtifactPreview, AptPublishSessionDetail } from "./publish";
import { aptPublishSessionArtifactSummary } from "./publish-model";
import { aptPublishTokenMissingRequiredScopes, aptPublishTokenSigningKeyIds } from "./token-scope";

export const aptHostedRepositoryDetailPlugin: HostedRepositoryDetailPlugin = {
  kind: "hosted",
  ecosystem: aptPluginManifest.ecosystem,
  sections: [
    { id: "settings", title: "APT settings", placement: "settings", Component: AptSettingsSection },
    { id: "advanced-json", title: "Advanced JSON config", placement: "settings", Component: AdvancedJsonConfigSection },
    { id: "signing-keys", title: "APT signing keys", placement: "settings", Component: AptSigningKeysSection },
    { id: "client-helpers", title: "APT client setup", placement: "workspace", summary: true, Component: RepositoryClientHelpersSection },
  ],
};

export const aptHostedRepositoryUiPlugin: HostedRepositoryUiPlugin = {
  kind: "hosted",
  manifest: aptPluginManifest,
  create: aptHostedRepositoryCreatePlugin,
  detail: aptHostedRepositoryDetailPlugin,
  publish: {
    ecosystem: aptPluginManifest.ecosystem,
    title: "Publish APT artifact",
    accept: ".deb,application/vnd.debian.binary-package",
    acceptedFileDescription: "Debian package files (.deb)",
    isAcceptedFile: (file) => file.name.toLowerCase().endsWith(".deb"),
    PreviewComponent: AptPublishArtifactPreview,
    SessionDetailComponent: AptPublishSessionDetail,
    artifactSummary: aptPublishSessionArtifactSummary,
  },
  createFieldRenderers: {
    "signing-key-provisioning": AptSigningKeySetupField,
  },
  publishTokenScope: {
    deriveSigningKeyIds: aptPublishTokenSigningKeyIds,
    missingRequiredScopes: aptPublishTokenMissingRequiredScopes,
  },
  mapCreateServerError: (message) => {
    if (/^config\.apt\.|Codename|Components|Architectures/i.test(message)) return "config";
    if (/Signing key/i.test(message)) return "setup";
    return undefined;
  },
};

const aptProxyRepositoryCreatePlugin: ProxyRepositoryCreatePlugin = {
  kind: "proxy",
  ecosystem: aptPluginManifest.ecosystem,
  repositoryConfig: {
    namespace: aptPluginManifest.repositoryConfig.namespace,
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
    ecosystem: aptPluginManifest.ecosystem,
    kind: "proxy",
    visibility: state.visibility,
    config: {
      [aptPluginManifest.repositoryConfig.namespace]: {},
    },
  }),
};

const aptGroupRepositoryCreatePlugin: GroupRepositoryCreatePlugin = {
  kind: "group",
  ecosystem: aptPluginManifest.ecosystem,
  repositoryConfig: {
    namespace: aptPluginManifest.repositoryConfig.namespace,
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
    ecosystem: aptPluginManifest.ecosystem,
    kind: "group",
    visibility: state.visibility,
    config: {
      [aptPluginManifest.repositoryConfig.namespace]: {},
    },
  }),
};

const aptProxyRepositoryDetailPlugin: ProxyRepositoryDetailPlugin = {
  kind: "proxy",
  ecosystem: aptPluginManifest.ecosystem,
  sections: [
    { id: "advanced-json", title: "Advanced JSON config", placement: "settings", Component: AdvancedJsonConfigSection },
  ],
};

const aptGroupRepositoryDetailPlugin: GroupRepositoryDetailPlugin = {
  kind: "group",
  ecosystem: aptPluginManifest.ecosystem,
  sections: [
    { id: "advanced-json", title: "Advanced JSON config", placement: "settings", Component: AdvancedJsonConfigSection },
  ],
};

export const aptProxyRepositoryUiPlugin: ProxyRepositoryUiPlugin = {
  kind: "proxy",
  manifest: aptPluginManifest,
  create: aptProxyRepositoryCreatePlugin,
  detail: aptProxyRepositoryDetailPlugin,
};

export const aptGroupRepositoryUiPlugin: GroupRepositoryUiPlugin = {
  kind: "group",
  manifest: aptPluginManifest,
  create: aptGroupRepositoryCreatePlugin,
  detail: aptGroupRepositoryDetailPlugin,
};
