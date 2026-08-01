import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = new URL(".", import.meta.url);
const workerFirstPaths = ["/admin/*", "/api/*", "/repositories/*", "/health"];

interface DevValues {
  UPLOAD_BACKEND?: string;
  R2_BUCKET_NAME?: string;
}

function readDevValues(repoRoot: URL): DevValues {
  const wranglerVars = readWranglerVars(repoRoot);
  return {
    ...wranglerVars,
    ...readDotDevVars(repoRoot),
  };
}

function readDotDevVars(repoRoot: URL): DevValues {
  const path = new URL(".dev.vars", repoRoot);
  if (!existsSync(path)) {
    return {};
  }

  const values: DevValues = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match) {
      continue;
    }
    const name = match[1];
    if (name === "UPLOAD_BACKEND" || name === "R2_BUCKET_NAME") {
      values[name] = unquoteDevValue(match[2] ?? "");
    }
  }
  return values;
}

function readWranglerVars(repoRoot: URL): DevValues {
  const config = parseJsonc(readFileSync(new URL("wrangler.jsonc", repoRoot), "utf8")) as {
    vars?: Record<string, string>;
  };
  return config.vars ?? {};
}

function unquoteDevValue(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\""))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseJsonc(text: string): unknown {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") {
      inString = true;
      out += char;
      continue;
    }
    if (char === "/" && text[index + 1] === "/") {
      while (index < text.length && text[index] !== "\n") index += 1;
      out += "\n";
      continue;
    }
    if (char === "/" && text[index + 1] === "*") {
      index += 2;
      while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) index += 1;
      index += 1;
      continue;
    }
    out += char;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

function r2BindingOverride(values: DevValues) {
  if ((values.UPLOAD_BACKEND ?? "r2") !== "r2" || !values.R2_BUCKET_NAME) {
    return {};
  }

  return {
    r2_buckets: [{
      binding: "AXIS_OBJECTS",
      bucket_name: values.R2_BUCKET_NAME,
      remote: true,
    }],
  };
}

export default defineConfig({
  root: "packages/admin-ui",
  plugins: [
    react(),
    cloudflare({
      configPath: "../../wrangler.jsonc",
      config: {
        assets: {
          not_found_handling: "single-page-application",
          run_worker_first: workerFirstPaths,
        },
        ...r2BindingOverride(readDevValues(root)),
      },
      persistState: {
        path: "../../.wrangler/state/vite",
      },
    }),
  ],
  resolve: {
    alias: [
      { find: "stream/web", replacement: fileURLToPath(new URL("scripts/worker-shims/stream-web.ts", root)) },
    ],
  },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 900,
  },
});
