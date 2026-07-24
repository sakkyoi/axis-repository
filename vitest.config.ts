import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@axis-repository/core/plugin-manifests": fileURLToPath(new URL("./packages/core/src/plugin-manifests.ts", import.meta.url)),
      "@axis-repository/core": fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)),
      "@axis-repository/runtime-cloudflare/plugin-runtime/testing": fileURLToPath(new URL("./packages/runtime-cloudflare/src/plugin-runtime-testing.ts", import.meta.url)),
      "@axis-repository/runtime-cloudflare/plugin-runtime": fileURLToPath(new URL("./packages/runtime-cloudflare/src/plugin-runtime.ts", import.meta.url)),
      "@axis-repository/admin-ui/plugin-ui": fileURLToPath(new URL("./packages/admin-ui/src/plugin-ui.ts", import.meta.url)),
    },
  },
  test: {
    include: ["packages/**/*.test.ts", "plugins/**/*.test.ts"],
    globals: false,
    passWithNoTests: true,
  },
});
