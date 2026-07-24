import type { RepositoryUiPlugin } from "@axis-repository/admin-ui/plugin-ui";
import { repositoryPluginCatalog } from "./catalog";
import { aptRepositoryUiPlugin } from "./apt/admin-ui";
import { pypiRepositoryUiPlugin } from "./pypi/admin-ui";

const adminUiPlugins: Record<string, RepositoryUiPlugin> = {
  apt: aptRepositoryUiPlugin,
  pypi: pypiRepositoryUiPlugin,
};

export const repositoryAdminUiPlugins = repositoryPluginCatalog
  .filter((entry) => entry.enabled && entry.adminUi)
  .map((entry) => {
    const plugin = adminUiPlugins[entry.manifest.ecosystem];
    if (!plugin) {
      throw new Error(`Admin UI plugin is not wired for ecosystem: ${entry.manifest.ecosystem}`);
    }
    return plugin;
  }) as [RepositoryUiPlugin, ...RepositoryUiPlugin[]];
