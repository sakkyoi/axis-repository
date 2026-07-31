import { defineConfig } from "vitest/config";
import { workspaceAliases } from "./scripts/workspace-aliases.js";

export default defineConfig({
  resolve: {
    alias: workspaceAliases(new URL(".", import.meta.url)),
  },
  test: {
    include: [
      "packages/**/*.test.ts",
      "packages/**/*.test.tsx",
      "plugins/**/*.test.ts",
      "plugins/**/*.test.tsx",
      "scripts/**/*.test.ts",
    ],
    globals: false,
    passWithNoTests: true,
  },
});
