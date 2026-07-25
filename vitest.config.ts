import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@axis-repository/core/plugin-manifests": fileURLToPath(new URL("./packages/core/src/plugins/plugin-manifests.ts", import.meta.url)),
      "@axis-repository/core": fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)),
      "@axis-repository/runtime-cloudflare/plugin-runtime/testing": fileURLToPath(new URL("./packages/runtime-cloudflare/src/plugin-runtime-testing.ts", import.meta.url)),
      "@axis-repository/runtime-cloudflare/plugin-runtime": fileURLToPath(new URL("./packages/runtime-cloudflare/src/plugin-runtime.ts", import.meta.url)),
      "@axis-repository/admin-ui/plugin-ui": fileURLToPath(new URL("./packages/admin-ui/src/plugin-ui.ts", import.meta.url)),
      "@axis-repository/plugin-apt/admin-ui/publish": fileURLToPath(new URL("./plugins/apt/admin-ui/publish.tsx", import.meta.url)),
      "@axis-repository/plugin-apt/admin-ui": fileURLToPath(new URL("./plugins/apt/admin-ui/index.ts", import.meta.url)),
      "@axis-repository/plugin-apt/manifest": fileURLToPath(new URL("./plugins/apt/manifest.ts", import.meta.url)),
      "@axis-repository/plugin-apt/runtime/publisher": fileURLToPath(new URL("./plugins/apt/runtime/publisher.ts", import.meta.url)),
      "@axis-repository/plugin-apt/runtime": fileURLToPath(new URL("./plugins/apt/runtime/runtime.ts", import.meta.url)),
      "@axis-repository/plugin-apt/test-support": fileURLToPath(new URL("./plugins/apt/runtime/deb-fixtures.test-support.ts", import.meta.url)),
      "@axis-repository/plugin-apt": fileURLToPath(new URL("./plugins/apt/plugin.ts", import.meta.url)),
      "@axis-repository/plugin-pypi/admin-ui/detail": fileURLToPath(new URL("./plugins/pypi/admin-ui/detail.tsx", import.meta.url)),
      "@axis-repository/plugin-pypi/admin-ui/publish": fileURLToPath(new URL("./plugins/pypi/admin-ui/publish.tsx", import.meta.url)),
      "@axis-repository/plugin-pypi/admin-ui": fileURLToPath(new URL("./plugins/pypi/admin-ui/index.ts", import.meta.url)),
      "@axis-repository/plugin-pypi/manifest": fileURLToPath(new URL("./plugins/pypi/manifest.ts", import.meta.url)),
      "@axis-repository/plugin-pypi/runtime": fileURLToPath(new URL("./plugins/pypi/runtime/runtime.ts", import.meta.url)),
      "@axis-repository/plugin-pypi": fileURLToPath(new URL("./plugins/pypi/plugin.ts", import.meta.url)),
    },
  },
  test: {
    include: ["packages/**/*.test.ts", "plugins/**/*.test.ts"],
    globals: false,
    passWithNoTests: true,
  },
});
