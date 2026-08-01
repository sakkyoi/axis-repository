import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { workspaceAliases } from "./scripts/workspace-aliases.js";

const root = new URL(".", import.meta.url);

export default defineConfig({
  root: "packages/admin-ui",
  plugins: [
    react(),
    cloudflare({
      configPath: "../../wrangler.jsonc",
      config: {
        assets: {
          not_found_handling: "single-page-application",
          run_worker_first: ["/admin/*", "/api/*", "/repositories/*", "/health"],
        },
      },
      persistState: {
        path: "../../.wrangler/state/vite",
      },
    }),
  ],
  resolve: {
    alias: [
      ...workspaceAliases(root),
      { find: "stream/web", replacement: fileURLToPath(new URL("scripts/worker-shims/stream-web.ts", root)) },
    ],
  },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 900,
  },
});
