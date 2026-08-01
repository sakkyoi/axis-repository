import { fileURLToPath } from "node:url";
import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/plugin-runtime.ts",
    "src/plugin-runtime-testing.ts",
  ],
  format: ["esm"],
  dts: true,
  esbuildOptions(options) {
    options.alias = {
      ...options.alias,
      "#admin-ui-assets-generated": fileURLToPath(
        new URL("./generated/admin-ui-assets.ts", import.meta.url),
      ),
    };
  },
});
