import { aptPluginManifest } from "../manifest";
import type {
  RepositoryDetailPlugin,
  RepositoryUiPlugin,
} from "@axis-repository/admin-ui/plugin-ui";
import {
  AdvancedJsonConfigSection,
  RepositoryClientHelpersSection,
} from "@axis-repository/admin-ui/plugin-ui";
import { aptRepositoryCreatePlugin } from "./create";
import { AptSigningKeySetupField } from "./create-field-renderers";
import { AptSettingsSection, AptSigningKeysSection } from "./detail";
import { AptPublishArtifactPreview, AptPublishSessionDetail } from "./publish";
import { aptPublishSessionArtifactSummary } from "./publish-model";
import { AptSigningKeyTokenScopeFields, aptPublishTokenMissingSigningKeySelections } from "./token-scope";

export const aptRepositoryDetailPlugin: RepositoryDetailPlugin = {
  ecosystem: aptPluginManifest.ecosystem,
  sections: [
    { id: "settings", title: "APT settings", placement: "settings", Component: AptSettingsSection },
    { id: "advanced-json", title: "Advanced JSON config", placement: "settings", Component: AdvancedJsonConfigSection },
    { id: "signing-keys", title: "APT signing keys", placement: "settings", Component: AptSigningKeysSection },
    { id: "client-helpers", title: "APT client setup", placement: "workspace", summary: true, Component: RepositoryClientHelpersSection },
  ],
};

export const aptRepositoryUiPlugin: RepositoryUiPlugin = {
  manifest: aptPluginManifest,
  create: aptRepositoryCreatePlugin,
  detail: aptRepositoryDetailPlugin,
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
    Component: AptSigningKeyTokenScopeFields,
    missingSelections: aptPublishTokenMissingSigningKeySelections,
  },
  mapCreateServerError: (message) => {
    if (/^config\.apt\.|Codename|Components|Architectures/i.test(message)) return "config";
    if (/Signing key/i.test(message)) return "setup";
    return undefined;
  },
};
