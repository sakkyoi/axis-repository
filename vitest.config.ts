import { readFile } from "node:fs/promises";
import { defineConfig, type Plugin } from "vitest/config";
import { workspaceAliases } from "./scripts/workspace-aliases";

/**
 * Resolves a `.wasm` import to an already-compiled module.
 *
 * Production gets this from wrangler, which uploads the binary as its own
 * module because a Cloudflare Worker refuses to compile WebAssembly at run
 * time. Node has no such restriction, so tests compile it while loading the
 * file and the code under test sees the same `WebAssembly.Module` either way.
 */
function compiledWasm(): Plugin {
  return {
    name: "axis-compiled-wasm",
    async load(id) {
      if (!id.endsWith(".wasm")) {
        return null;
      }
      const base64 = (await readFile(id.split("?")[0] ?? id)).toString("base64");
      return `const bytes = Uint8Array.from(atob(${JSON.stringify(base64)}), (c) => c.charCodeAt(0));
export default new WebAssembly.Module(bytes);`;
    },
  };
}

export default defineConfig({
  plugins: [compiledWasm()],
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
