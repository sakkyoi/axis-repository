import type { RepositoryPluginBundle } from "../bundled";
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
