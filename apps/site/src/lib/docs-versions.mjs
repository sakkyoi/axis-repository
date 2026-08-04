import { readFileSync } from "node:fs";
import { join } from "node:path";

// docs-versions.json is the single source of truth for which release
// snapshots exist -- see astro.config.mjs for how it's populated. Shared
// here (rather than duplicated) since both the Starlight config and the
// marketing pages need to resolve "the latest stable version" for their
// own docs links.
//
// Resolved from process.cwd() rather than import.meta.url: astro.config.mjs
// imports this module directly (unbundled, import.meta.url matches its real
// source location), but the marketing pages import it too, and Vite bundles
// page code into dist/.prerender/chunks/ for prerendering -- import.meta.url
// there points at the bundled chunk's own location, not this file's original
// one, so a relative path from it silently resolved to a nonexistent
// dist/docs-versions.json and crashed the build. cwd is reliably apps/site/
// in both contexts, since every script here runs via `pnpm --filter
// @axis-repository/site <cmd>`.
const docsVersionsPath = join(process.cwd(), "docs-versions.json");

export function getDocsVersions() {
  return JSON.parse(readFileSync(docsVersionsPath, "utf8"));
}

export function getLatestStableVersion() {
  return getDocsVersions()
    .filter((version) => !version.slug.includes("-rc."))
    .sort(compareVersionSlugsDescending)[0];
}

function compareVersionSlugsDescending(a, b) {
  // Slugs keep the tag's leading "v" (e.g. "v0.3.0-rc.1") -- stripped here
  // only for numeric comparison, not for the slug value itself.
  const toParts = (slug) =>
    slug
      .replace(/^v/, "")
      .split("-rc.")[0]
      .split(".")
      .map(Number);
  const [aMajor, aMinor, aPatch] = toParts(a.slug);
  const [bMajor, bMinor, bPatch] = toParts(b.slug);
  return bMajor - aMajor || bMinor - aMinor || bPatch - aPatch;
}

// Matches the route starlight-versions actually generates: the version
// slug comes *before* the page's own path (/v0.0.0/docs/), not after it.
export function getLatestStableDocsHref() {
  const latest = getLatestStableVersion();
  return latest ? `/${latest.slug}/docs/` : "/docs/";
}
