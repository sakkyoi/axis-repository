import type { RepositoryPluginManifest } from "@axis-repository/core/plugin-manifests";
import { aptPluginManifest } from "./apt/manifest";
import { pypiPluginManifest } from "./pypi/manifest";

export interface RepositoryPluginCatalogEntry {
  manifest: RepositoryPluginManifest;
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
}

export const repositoryPluginCatalog = [
  {
    manifest: aptPluginManifest,
    enabled: true,
    experimental: false,
    runtime: true,
    adminUi: true,
  },
  {
    manifest: pypiPluginManifest,
    enabled: true,
    experimental: true,
    runtime: true,
    adminUi: true,
  },
] as const satisfies readonly RepositoryPluginCatalogEntry[];

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
  }));
}
