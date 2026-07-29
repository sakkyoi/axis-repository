#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Starts the local Worker with the flags its upload backend requires.
 *
 * `--local` means "run locally with remote bindings disabled", which is less a
 * preference than a consequence. A signed upload URL always addresses R2
 * itself, so under `UPLOAD_BACKEND=r2` a binding answered from local state
 * never sees what was uploaded — and says so only at the end, when publishing
 * reports a file that plainly arrived as missing. Under the other backends the
 * Worker stores the bytes itself and reaching for the network would be worse.
 *
 * One setting decides both, so it decides both here rather than being a rule
 * to remember.
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const DEV_CONFIG = "wrangler.dev.jsonc";

function uploadBackend() {
  const devVars = `${root}.dev.vars`;
  if (!existsSync(devVars)) {
    return "r2";
  }
  for (const line of readFileSync(devVars, "utf8").split(/\r?\n/)) {
    const match = /^\s*UPLOAD_BACKEND\s*=\s*(.*?)\s*$/.exec(line);
    if (match) {
      return match[1] || "r2";
    }
  }
  // Unset means `r2`, the same as the Worker reads it.
  return "r2";
}

/**
 * Finds the configuration that points the binding at a real bucket.
 *
 * `wrangler.jsonc` describes a deployment and says nothing about development,
 * so running against real storage needs a configuration of your own. Wrangler
 * substitutes nothing and inherits no bindings, so it is a whole file rather
 * than an overlay — copy `wrangler.jsonc`, name your bucket, and mark it
 * `remote: true`.
 */
function requireDevConfig() {
  const path = `${root}${DEV_CONFIG}`;
  if (!existsSync(path)) {
    console.error(
      `UPLOAD_BACKEND=r2 signs upload URLs that address R2 itself, so AXIS_OBJECTS`
        + ` has to read the real bucket. That needs ${DEV_CONFIG}, which is not`
        + ` here.\n\n`
        + `  cp wrangler.jsonc ${DEV_CONFIG}\n\n`
        + `Then name the bucket you develop against, matching R2_BUCKET_NAME in`
        + ` .dev.vars, and add \`"remote": true\` beside it. Or set`
        + ` UPLOAD_BACKEND=local-r2 in .dev.vars to develop offline instead.`,
    );
    process.exit(1);
  }
  if (!/"remote"\s*:\s*true/.test(readFileSync(path, "utf8"))) {
    console.error(
      `${DEV_CONFIG} has no R2 binding marked \`"remote": true\`, so uploads would`
        + ` land in a bucket this Worker cannot read. Add it beside the bucket`
        + ` name.`,
    );
    process.exit(1);
  }
  return path;
}

const backend = uploadBackend();
const args = ["dev"];

if (backend === "r2") {
  args.push("--config", DEV_CONFIG);
  requireDevConfig();
} else {
  args.push("--local");
}
// `pnpm run dev:worker -- --port 8799` forwards the separator too, and
// wrangler reads everything after it as positional rather than as flags.
const forwarded = process.argv.slice(2);
args.push(...(forwarded[0] === "--" ? forwarded.slice(1) : forwarded));

console.error(`UPLOAD_BACKEND=${backend} → wrangler ${args.join(" ")}`);
spawn("wrangler", args, { stdio: "inherit", shell: true })
  .on("exit", (code) => process.exit(code ?? 1));
