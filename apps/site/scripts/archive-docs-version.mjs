#!/usr/bin/env node
// Archives the docs content from a given git tag into a new versioned
// snapshot for starlight-versions to pick up, run by CI on every v* tag
// push (see .github/workflows/site-archive-version.yml).
//
// This mirrors what starlight-versions' own archiving does when you add a
// version to its config and run `astro dev`/`astro build` locally -- moving
// the current docs content into src/content/docs/<slug>/ and writing a
// matching src/content/versions/<slug>.json -- except driven by a specific
// historical tag's content instead of the current working tree, since
// release tags can be cut from a release branch that hasn't merged back to
// main yet, and the plugin only lets one new version be configured at a
// time, which doesn't fit invoking it fresh in CI on every deploy.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const tag = process.argv[2];
if (!tag) {
  console.error("Usage: archive-docs-version.mjs <tag>");
  process.exit(1);
}

// The slug is the tag as-is (e.g. "v0.3.0", "v0.3.0-rc.1") -- kept
// identical to the release tag rather than dropped, so the version shown
// in the switcher and its URL always match the tag someone would look up
// on GitHub.
const slug = tag;
const siteDir = fileURLToPath(new URL("..", import.meta.url));
const versionsConfigPath = join(siteDir, "docs-versions.json");
const docsDir = join(siteDir, "src/content/docs");
const versionsContentDir = join(siteDir, "src/content/versions");

const versions = JSON.parse(readFileSync(versionsConfigPath, "utf8"));

if (versions.some((version) => version.slug === slug)) {
  console.log(`Version '${slug}' is already archived -- nothing to do.`);
  process.exit(0);
}

const knownSlugs = new Set(versions.map((version) => version.slug));

const worktreeDir = mkdtempSync(join(tmpdir(), "axis-docs-archive-"));
execFileSync("git", ["worktree", "add", "--detach", worktreeDir, tag], { stdio: "inherit" });

try {
  const tagDocsDir = join(worktreeDir, "apps/site/src/content/docs");
  const newVersionDir = join(docsDir, slug);
  mkdirSync(newVersionDir, { recursive: true });

  for (const entry of readdirSync(tagDocsDir)) {
    // Anything matching an already-known slug was itself an archived
    // version by the time this tag was cut -- it already lives on main
    // and shouldn't be nested a second time under the new version.
    if (knownSlugs.has(entry)) continue;
    cpSync(join(tagDocsDir, entry), join(newVersionDir, entry), { recursive: true });
  }

  // Matches the { sidebar } shape starlight-versions itself writes when
  // archiving a version locally (see its libs/versions.ts
  // makeVersionConfig()). Keep this in sync with astro.config.mjs's own
  // `sidebar` option if that ever changes.
  mkdirSync(versionsContentDir, { recursive: true });
  writeFileSync(
    join(versionsContentDir, `${slug}.json`),
    `${JSON.stringify(
      { sidebar: [{ label: "Guides", items: [{ autogenerate: { directory: "docs" } }] }] },
      null,
      2,
    )}\n`,
  );

  writeFileSync(versionsConfigPath, `${JSON.stringify([...versions, { slug }], null, 2)}\n`);

  console.log(`Archived version '${slug}'.`);
} finally {
  execFileSync("git", ["worktree", "remove", "--force", worktreeDir]);
}
