import type { RepositoryPluginManifest } from "@axis-repository/core/plugin-manifests";
import { resolvePluginIconAssets, type ResolvedPluginIconAssets } from "@axis-repository/core/plugin-icons";
import { bundledRepositoryPlugins } from "./bundled";

export interface RepositoryPluginCatalogEntry {
  manifest: RepositoryPluginManifest;
  icon: ResolvedPluginIconAssets;
  enabled: boolean;
  experimental: boolean;
  runtime: boolean;
  adminUi: boolean;
}

export interface RepositoryPluginCatalogMetadata {
  ecosystem: string;
  enabled: boolean;
  experimental: boolean;
  runtime: boolean;
  adminUi: boolean;
  icon: ResolvedPluginIconAssets;
}

export const repositoryPluginCatalog = bundledRepositoryPlugins.map((plugin) => ({
  manifest: plugin.manifest,
  icon: resolvePluginIconAssets(plugin.manifest.icon),
  enabled: plugin.catalog.enabled,
  experimental: plugin.catalog.experimental,
  runtime: plugin.runtime,
  adminUi: plugin.adminUi,
})) satisfies readonly RepositoryPluginCatalogEntry[];

export function repositoryPluginCatalogEcosystems(): string[] {
  return repositoryPluginCatalog.map((entry) => entry.manifest.ecosystem);
}

export function getRepositoryPluginCatalogEntry(ecosystem: string): RepositoryPluginCatalogEntry | undefined {
  return repositoryPluginCatalog.find((entry) => entry.manifest.ecosystem === ecosystem);
}

export function repositoryPluginCatalogMetadata(): RepositoryPluginCatalogMetadata[] {
  return repositoryPluginCatalog.map((entry) => ({
    ecosystem: entry.manifest.ecosystem,
    enabled: entry.enabled,
    experimental: entry.experimental,
    runtime: entry.runtime,
    adminUi: entry.adminUi,
    icon: { ...entry.icon },
  }));
}
