import type { RepositoryPluginBundle } from "../bundled";
import { aptPluginManifest } from "./manifest";

export const aptRepositoryPluginBundle = {
  manifest: aptPluginManifest,
  catalog: {
    enabled: true,
    experimental: false,
  },
  runtime: true,
  adminUi: true,
} satisfies RepositoryPluginBundle;
