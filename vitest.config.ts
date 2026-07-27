import { defineConfig } from "vitest/config";
import { workspaceAliases } from "./scripts/workspace-aliases";

export default defineConfig({
  resolve: {
    alias: workspaceAliases(new URL(".", import.meta.url)),
  },
  test: {
    include: ["packages/**/*.test.ts", "packages/**/*.test.tsx", "plugins/**/*.test.ts", "plugins/**/*.test.tsx"],
    globals: false,
    passWithNoTests: true,
    // Only component tests need a DOM; everything else stays on the faster
    // default environment.
    environmentMatchGlobs: [["**/*.test.tsx", "happy-dom"]],
  },
});
