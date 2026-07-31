import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { workspaceAliases } from "../../scripts/workspace-aliases";

/**
 * Where the dev server sends what it does not serve itself.
 *
 * The console asks its own origin for everything -- there is no base URL to
 * point elsewhere, because in a deployment the Worker serves both. Forwarding
 * these keeps that true here: the browser sees one origin, so the session
 * cookie belongs to it and nothing has to be relaxed to let a second one read
 * it.
 *
 * `/ui` is missing on purpose. That is the console, and in development this
 * server is the thing that serves it.
 */
const WORKER_PATHS = ["/admin", "/api", "/repositories", "/health"];

const DEFAULT_WORKER_ORIGIN = "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: Object.fromEntries(WORKER_PATHS.map((path) => [path, {
      target: process.env.AXIS_WORKER_ORIGIN ?? DEFAULT_WORKER_ORIGIN,
      changeOrigin: true,
    }])),
  },
  resolve: {
    alias: workspaceAliases(new URL("../../", import.meta.url)),
  },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 900,
  },
});
