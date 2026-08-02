import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { applyAxisWorkerConfig, devRemoteBindings, readDevValues } from "./vite.dev-config";

const root = new URL(".", import.meta.url);

const devValues = readDevValues(root);

export default defineConfig({
  root: "packages/admin-ui",
  plugins: [
    react(),
    cloudflare({
      configPath: "../../wrangler.jsonc",
      config: (config) => applyAxisWorkerConfig(config, devValues),
      remoteBindings: devRemoteBindings(devValues),
      persistState: {
        path: "../../.wrangler/state/vite",
      },
    }),
  ],
  resolve: {
    alias: [
      {
        find: "stream/web",
        replacement: fileURLToPath(new URL("packages/runtime-cloudflare/src/worker-shims/stream-web.ts", root)),
      },
      {
        find: "#admin-ui-assets-generated",
        replacement: fileURLToPath(new URL("packages/runtime-cloudflare/src/admin-ui-assets/generated-dev.ts", root)),
      },
    ],
  },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 900,
  },
});
