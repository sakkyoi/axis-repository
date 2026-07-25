import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@axis-repository/core/plugin-manifests": fileURLToPath(new URL("../../packages/core/src/plugins/plugin-manifests.ts", import.meta.url)),
      "@axis-repository/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
      "@axis-repository/admin-ui/plugin-ui": fileURLToPath(new URL("../../packages/admin-ui/src/plugin-ui.ts", import.meta.url)),
      "@axis-repository/plugin-apt/admin-ui/publish": fileURLToPath(new URL("../../plugins/apt/admin-ui/publish.tsx", import.meta.url)),
      "@axis-repository/plugin-apt/admin-ui": fileURLToPath(new URL("../../plugins/apt/admin-ui/index.ts", import.meta.url)),
      "@axis-repository/plugin-apt/manifest": fileURLToPath(new URL("../../plugins/apt/manifest.ts", import.meta.url)),
      "@axis-repository/plugin-apt": fileURLToPath(new URL("../../plugins/apt/plugin.ts", import.meta.url)),
      "@axis-repository/plugin-pypi/admin-ui/detail": fileURLToPath(new URL("../../plugins/pypi/admin-ui/detail.tsx", import.meta.url)),
      "@axis-repository/plugin-pypi/admin-ui/publish": fileURLToPath(new URL("../../plugins/pypi/admin-ui/publish.tsx", import.meta.url)),
      "@axis-repository/plugin-pypi/admin-ui": fileURLToPath(new URL("../../plugins/pypi/admin-ui/index.ts", import.meta.url)),
      "@axis-repository/plugin-pypi/manifest": fileURLToPath(new URL("../../plugins/pypi/manifest.ts", import.meta.url)),
      "@axis-repository/plugin-pypi": fileURLToPath(new URL("../../plugins/pypi/plugin.ts", import.meta.url)),
    },
  },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 900,
  },
});
