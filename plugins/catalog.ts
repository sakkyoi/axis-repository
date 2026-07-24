import { aptPluginManifest } from "./apt/manifest";
import { pypiPluginManifest } from "./pypi/manifest";

export const repositoryPluginCatalog = [
  {
    manifest: aptPluginManifest,
    runtime: true,
    adminUi: true,
  },
  {
    manifest: pypiPluginManifest,
    runtime: true,
    adminUi: true,
  },
] as const;

export type RepositoryPluginCatalogEntry = (typeof repositoryPluginCatalog)[number];

export function repositoryPluginCatalogEcosystems(): string[] {
  return repositoryPluginCatalog.map((entry) => entry.manifest.ecosystem);
}
