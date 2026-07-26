import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { workspaceAliases } from "../../scripts/workspace-aliases";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: workspaceAliases(new URL("../../", import.meta.url)),
  },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 900,
  },
});
