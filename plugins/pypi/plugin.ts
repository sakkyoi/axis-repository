import type { RepositoryPluginBundle } from "@axis-repository/core/plugin-manifests";
import { pypiPluginManifest } from "./manifest";

export const pypiRepositoryPluginBundle = {
  manifest: pypiPluginManifest,
  catalog: {
    enabled: true,
    experimental: true,
  },
  runtime: true,
  adminUi: true,
} satisfies RepositoryPluginBundle;
