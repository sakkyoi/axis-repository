import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { defineConfig, fontProviders } from "astro/config";
import starlight from "@astrojs/starlight";
import starlightThemeRapide from "starlight-theme-rapide";
import starlightSiteGraph from "starlight-site-graph";
import starlightVersions from "starlight-versions";
import icon from "astro-icon";
import tailwindcss from "@tailwindcss/vite";

// docs-versions.json is the single source of truth for which release
// snapshots exist. CI appends to it (and archives the matching
// src/content/docs/<slug>/ snapshot) whenever a v* tag is pushed -- see
// .github/workflows/site.yml. The unarchived root (src/content/docs/**)
// always mirrors whatever's on main right now, so it needs no entry here:
// it's what the "Dev" version in the switcher points at.
const docsVersions = JSON.parse(
  readFileSync(fileURLToPath(new URL("./docs-versions.json", import.meta.url)), "utf8"),
);

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

const latestStableVersion = docsVersions
  .filter((version) => !version.slug.includes("-rc."))
  .sort(compareVersionSlugsDescending)[0];

// Lands visitors who hit the bare /docs/ entry point on the latest stable
// release instead of the unversioned "Dev" content. Deep links into Dev
// stay put and rely on the plugin's own "you're viewing an unreleased
// version" banner instead of a redirect, since a blanket /docs/* redirect
// could send someone to a page that doesn't exist yet in the last stable
// release.
function redirectDocsRootToLatestStable() {
  return {
    name: "redirect-docs-root-to-latest-stable",
    hooks: {
      "astro:build:done": async ({ dir }) => {
        if (!latestStableVersion) return;

        // starlight-versions puts the version slug *before* the page's own
        // path (/v0.0.0/docs/), not after it -- confirmed against a real
        // deploy after an earlier /docs/<slug>/ version of this redirect
        // pointed at a route that doesn't exist.
        const target = `/${latestStableVersion.slug}/docs/`;
        await writeFile(
          fileURLToPath(new URL("_redirects", dir)),
          `/docs ${target} 302\n/docs/ ${target} 302\n`,
        );
      },
    },
  };
}

export default defineConfig({
  // Astro's own font pipeline generates the @font-face CSS and preload
  // links at build time (see src/components/Head.astro), instead of the
  // site title wordmark pulling in @fontsource's CSS at runtime with its
  // default font-display: swap -- which flashed the fallback font first on
  // every load, only swapping to Space Grotesk once the file finished
  // downloading. display: "optional" here means the browser either has the
  // font in time or quietly keeps the (metrics-matched, auto-generated)
  // fallback, never swapping late.
  fonts: [
    {
      provider: fontProviders.local(),
      name: "Space Grotesk",
      cssVariable: "--font-site-title",
      options: {
        variants: [
          {
            weight: "600",
            style: "normal",
            display: "optional",
            src: ["@fontsource/space-grotesk/files/space-grotesk-latin-600-normal.woff2"],
          },
        ],
      },
    },
  ],
  integrations: [
    starlight({
      title: "Axis Repository",
      components: {
        Head: "./src/components/Head.astro",
        SiteTitle: "./src/components/SiteTitle.astro",
        ThemeSelect: "./src/components/ThemeSelect.astro",
      },
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/sakkyoi/axis-repository" },
      ],
      // Not using Starlight's own `favicon` option: it renders as `rel="shortcut
      // icon"`, and Starlight's internal head-sorting always pushes that below
      // any plain `rel="icon"` entries regardless -- so it would still need
      // src/middleware.ts's fixup to stop it from winning. Two plain
      // `rel="icon"` entries, light first as the fallback and dark second as
      // the override, are what actually control the favicon here -- the same
      // technique the root README's picture/source tags use for these same
      // two files.
      head: [
        {
          tag: "link",
          attrs: { rel: "icon", type: "image/svg+xml", href: "/logo-mark-light.svg" },
        },
        {
          tag: "link",
          attrs: {
            rel: "icon",
            type: "image/svg+xml",
            href: "/logo-mark-dark.svg",
            media: "(prefers-color-scheme: dark)",
          },
        },
      ],
      plugins: [
        starlightThemeRapide(),
        starlightSiteGraph(),
        starlightVersions({
          current: { label: "Dev" },
          versions: docsVersions,
        }),
      ],
      sidebar: [
        {
          label: "Guides",
          items: [{ autogenerate: { directory: "docs" } }],
        },
      ],
    }),
    icon(),
    redirectDocsRootToLatestStable(),
  ],
  // Tailwind v4's Vite plugin processes any CSS file that `@import
  // "tailwindcss"`, and nothing else. The marketing layout is the only file
  // that imports it (src/styles/tailwind.css), which is what keeps Tailwind's
  // base reset -- margins, headings, typography -- from fighting Starlight's
  // own docs styling. There's no separate "applyBaseStyles" option to set
  // here like there was for @astrojs/tailwind; scoping the import IS the
  // mechanism.
  vite: {
    plugins: [tailwindcss()],
  },
});
