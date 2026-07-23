import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@axis-repository/core/plugin-manifests": fileURLToPath(new URL("./packages/core/src/plugin-manifests.ts", import.meta.url)),
      "@axis-repository/core": fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["packages/**/*.test.ts"],
    globals: false,
    passWithNoTests: true,
  },
});
