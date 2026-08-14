import { aptPluginManifest } from "../manifest";
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
import {
  AdvancedJsonConfigSection,
  RepositoryClientHelpersSection,
  repositoryCreateStepsForConfig,
} from "@axis-repository/admin-ui/plugin-ui";
import { aptHostedRepositoryCreatePlugin } from "./create";
import { AptSigningKeySetupField } from "./create-field-renderers";
import { AptProxySettingsSection, AptSettingsSection, AptSigningKeysSection } from "./detail";
import { buildAptSigningKeyProvisioning } from "./forms";
import { AptPublishArtifactPreview, AptPublishSessionDetail } from "./publish";
import { aptPublishSessionArtifactSummary } from "./publish-model";
import { aptPublishTokenMissingRequiredScopes, aptPublishTokenSigningKeyIds } from "./token-scope";

export const aptHostedRepositoryDetailPlugin: HostedRepositoryDetailPlugin = {
  kind: "hosted",
  ecosystem: aptPluginManifest.ecosystem,
  sections: [
    { id: "apt-settings", title: "APT settings", placement: "settings", Component: AptSettingsSection },
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

const aptProxyRepositoryConfig: PluginRepositoryConfigManifest = {
  namespace: aptPluginManifest.repositoryConfig.namespace,
  fields: [
    {
      name: "upstreamUrl",
      label: "Upstream URL",
      kind: "text",
      step: "config",
      required: true,
      placeholder: "https://deb.debian.org/debian/",
      description: "The APT repository base URL this proxy reads from.",
    },
    {
      name: "codename",
      label: "Codename",
      kind: "text",
      step: "config",
      required: true,
      placeholder: "bookworm",
      description: "Distribution codename under dists/ to probe and index.",
    },
    {
      name: "components",
      label: "Components",
      kind: "string-list",
      step: "config",
      required: false,
      placeholder: "leave empty to read Release metadata",
      description: "Optional component filter, space separated.",
    },
    {
      name: "architectures",
      label: "Architectures",
      kind: "string-list",
      step: "config",
      required: false,
      placeholder: "leave empty to read Release metadata",
      description: "Optional architecture filter, space separated.",
    },
    {
      name: "signingPolicy",
      label: "Signing policy",
      kind: "signing-key-provisioning",
      step: "setup",
      required: true,
      description: "Choose whether this proxy keeps upstream signatures, re-signs Release metadata, or publishes unsigned metadata.",
    },
  ],
};

const aptProxyRepositoryCreatePlugin: ProxyRepositoryCreatePlugin = {
  kind: "proxy",
  ecosystem: aptPluginManifest.ecosystem,
  repositoryConfig: aptProxyRepositoryConfig,
  steps: repositoryCreateStepsForConfig(aptProxyRepositoryConfig),
  defaults: {
    name: "",
    visibility: "private",
    config: {
      upstreamUrl: "",
      codename: "",
      components: "",
      architectures: "",
    },
    setup: {
      signingMode: "upstream",
      upstreamKeyUrl: "",
      signingKeyMode: "generate",
      signingKeyName: "release",
      signingKeyUserIdName: "Axis Repository",
      signingKeyUserIdEmail: "",
      signingKeyPrivateKeyArmored: "",
      signingKeyPassphrase: "",
      signingKeyExistingId: "",
    },
  },
  validateStep: (step, state) => {
    if (step === "basics") {
      return state.name.trim() ? [] : ["Repository name is required"];
    }
    if (step === "config" && !state.config.upstreamUrl?.trim()) {
      return ["Upstream URL is required"];
    }
    if (step === "config" && !state.config.codename?.trim()) {
      return ["Codename is required"];
    }
    if (step === "setup" && state.setup.signingMode === "axis") {
      try {
        buildAptSigningKeyProvisioning(state.setup);
        return [];
      } catch (error) {
        return [error instanceof Error ? error.message : "Signing key is required"];
      }
    }
    return [];
  },
  buildCreateInput: (state) => ({
    name: state.name,
    ecosystem: aptPluginManifest.ecosystem,
    kind: "proxy",
    visibility: state.visibility,
    config: {
      [aptPluginManifest.repositoryConfig.namespace]: {
        upstreamUrl: normalizeAptProxyUpstreamUrl(state.config.upstreamUrl?.trim() ?? ""),
        signing: aptProxySigningConfig(state.setup),
        codename: state.config.codename?.trim() ?? "",
        ...optionalStringList("components", state.config.components),
        ...optionalStringList("architectures", state.config.architectures),
      },
    },
    ...(state.setup.signingMode === "axis"
      ? {
        provisioning: {
          apt: {
            signingKey: buildAptSigningKeyProvisioning(state.setup),
          },
        },
      }
      : {}),
  }),
};

function aptProxySigningConfig(setup: Record<string, string>): Record<string, string> {
  if (setup.signingMode === "axis") {
    return { mode: "axis" };
  }
  if (setup.signingMode === "unsigned") {
    return { mode: "unsigned" };
  }
  return {
    mode: "upstream",
    ...optionalHttpUrl("upstreamKeyUrl", setup.upstreamKeyUrl),
  };
}

function normalizeAptProxyUpstreamUrl(value: string): string {
  if (!value) {
    return value;
  }
  const withScheme = normalizeAptProxyHttpUrl(value);
  return withScheme.endsWith("/") ? withScheme : `${withScheme}/`;
}

function normalizeAptProxyHttpUrl(value: string): string {
  return /^[a-z][a-z\d+.-]*:/iu.test(value) ? value : `https://${value}`;
}

function optionalHttpUrl(field: string, value: string | undefined): Record<string, string> {
  const trimmed = value?.trim() ?? "";
  return trimmed ? { [field]: normalizeAptProxyHttpUrl(trimmed) } : {};
}

function optionalStringList(field: string, value: string | undefined): Record<string, string[]> {
  const items = parseStringList(value);
  return items.length > 0 ? { [field]: items } : {};
}

function parseStringList(value: string | undefined): string[] {
  return [...new Set((value ?? "")
    .split(/[\s,]+/u)
    .map((item) => item.trim())
    .filter(Boolean))];
}

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
    { id: "client-helpers", title: "APT client setup", placement: "workspace", summary: true, Component: RepositoryClientHelpersSection },
    { id: "proxy-settings", title: "APT proxy settings", placement: "settings", Component: AptProxySettingsSection },
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
  createFieldRenderers: {
    "signing-key-provisioning": AptSigningKeySetupField,
  },
};

export const aptGroupRepositoryUiPlugin: GroupRepositoryUiPlugin = {
  kind: "group",
  manifest: aptPluginManifest,
  create: aptGroupRepositoryCreatePlugin,
  detail: aptGroupRepositoryDetailPlugin,
};
