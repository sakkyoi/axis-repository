import { aptPluginManifest } from "@axis-repository/core/plugin-manifests";
import type { RepositoryDetailPlugin, RepositoryUiPlugin } from "../../repository-ui-plugin-types";
import { AdvancedJsonConfigSection, RepositoryClientHelpersSection } from "../../repository-detail-shared";
import { aptRepositoryCreatePlugin } from "./create";
import { AptSettingsSection, AptSigningKeysSection } from "./detail";
import { AptPublishSessionsSection } from "./publish";

export const aptRepositoryDetailPlugin: RepositoryDetailPlugin = {
  ecosystem: aptPluginManifest.ecosystem,
  sections: [
    { id: "settings", title: "APT settings", Component: AptSettingsSection },
    { id: "publish-sessions", title: "Publish sessions", Component: AptPublishSessionsSection },
    { id: "advanced-json", title: "Advanced JSON config", Component: AdvancedJsonConfigSection },
    { id: "signing-keys", title: "APT signing keys", Component: AptSigningKeysSection },
    { id: "client-helpers", title: "APT client setup", Component: RepositoryClientHelpersSection },
  ],
};

export const aptRepositoryUiPlugin: RepositoryUiPlugin = {
  manifest: aptPluginManifest,
  create: aptRepositoryCreatePlugin,
  detail: aptRepositoryDetailPlugin,
  mapCreateServerError: (message) => {
    if (/^config\.apt\.|Codename|Components|Architectures/i.test(message)) return "config";
    if (/Signing key/i.test(message)) return "dependencies";
    return undefined;
  },
};
