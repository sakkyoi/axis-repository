import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@axis-repository/core/plugin-manifests": fileURLToPath(new URL("../../packages/core/src/plugin-manifests.ts", import.meta.url)),
      "@axis-repository/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
    },
  },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 900,
  },
});
