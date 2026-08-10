import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@axis-repository/plugin-apt": fileURLToPath(new URL("../../plugins/apt", import.meta.url)),
      "@axis-repository/plugin-pypi": fileURLToPath(new URL("../../plugins/pypi", import.meta.url)),
    },
  },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 900,
  },
});
