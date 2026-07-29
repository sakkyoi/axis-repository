#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Starts the local Worker with the configuration its upload backend requires.
 *
 * `--local` means "run locally with remote bindings disabled", which is less a
 * preference than a consequence. A signed upload URL always addresses R2
 * itself, so under `UPLOAD_BACKEND=r2` a binding answered from local state
 * never sees what was uploaded — and says so only at the end, when publishing
 * reports a file that plainly arrived as missing. Under the other backends the
 * Worker stores the bytes itself and reaching for the network would be worse.
 *
 * Running against a real bucket needs two things the deployment configuration
 * does not say: which bucket, and that the binding is `remote`. Both are
 * derived here rather than kept in a second configuration file — one would be
 * `wrangler.jsonc` copied with two lines changed, with nothing to keep the
 * rest of it in step, and the bucket is already named in `.dev.vars`.
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const GENERATED = `${root}.wrangler/dev-config.json`;

function devVar(name) {
  const path = `${root}.dev.vars`;
  if (!existsSync(path)) {
    return undefined;
  }
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = new RegExp(`^\\s*${name}\\s*=\\s*(.*?)\\s*$`).exec(line);
    if (match) {
      return match[1] || undefined;
    }
  }
  return undefined;
}

/**
 * Reads JSONC well enough for a configuration we own.
 *
 * Comments are stripped outside of strings; a `//` inside a bucket name or a
 * path would otherwise take the rest of the line with it.
 */
function parseJsonc(text) {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
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
    if (char === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      out += "\n";
      continue;
    }
    if (char === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
      i += 1;
      continue;
    }
    out += char;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

/**
 * The deployment configuration, pointed at a bucket you can develop against.
 *
 * Written beside the local state rather than into the project, so nothing
 * about developing has to be kept out of version control by hand. `main` is
 * made absolute because paths resolve against the configuration's own
 * directory, which is no longer the root.
 */
function generateDevConfig(bucketName) {
  const config = parseJsonc(readFileSync(`${root}wrangler.jsonc`, "utf8"));
  config.main = `${root}${config.main}`;
  config.r2_buckets = (config.r2_buckets ?? []).map((bucket) => ({
    ...bucket,
    bucket_name: bucketName,
    remote: true,
  }));
  mkdirSync(`${root}.wrangler`, { recursive: true });
  writeFileSync(GENERATED, `${JSON.stringify(config, null, 2)}\n`);
  return GENERATED;
}

const backend = devVar("UPLOAD_BACKEND") ?? "r2";
const args = ["dev"];

if (backend === "r2") {
  const bucketName = devVar("R2_BUCKET_NAME");
  if (!bucketName) {
    console.error(
      "UPLOAD_BACKEND=r2 signs upload URLs that address R2 itself, so the"
        + " binding has to read the real bucket and this needs to know which one."
        + "\n\nSet R2_BUCKET_NAME in .dev.vars to the bucket you develop against,"
        + " or set UPLOAD_BACKEND=local-r2 to develop offline instead.",
    );
    process.exit(1);
  }
  // Both are named absolutely: a configuration is read relative to its own
  // directory, and this one does not sit in the project root, so `.dev.vars`
  // would be looked for beside it and quietly not found.
  args.push("--config", generateDevConfig(bucketName), "--env-file", `${root}.dev.vars`);
  console.error(`UPLOAD_BACKEND=r2 → ${bucketName}, bound remotely`);
} else {
  args.push("--local");
  console.error(`UPLOAD_BACKEND=${backend} → local bindings`);
}

// `pnpm run dev:worker -- --port 8799` forwards the separator too, and
// wrangler reads everything after it as positional rather than as flags.
const forwarded = process.argv.slice(2);
args.push(...(forwarded[0] === "--" ? forwarded.slice(1) : forwarded));

spawn("wrangler", args, { stdio: "inherit", shell: true })
  .on("exit", (code) => process.exit(code ?? 1));
