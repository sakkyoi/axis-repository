import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import starlightThemeRapide from "starlight-theme-rapide";
import starlightSiteGraph from "starlight-site-graph";
import icon from "astro-icon";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  integrations: [
    starlight({
      title: "Axis Repository",
      // Not using Starlight's own `favicon` option: it renders as `rel="shortcut
      // icon"`, which Starlight's internal head-sorting always pushes after any
      // plain `rel="icon"` entries -- fine for its intended svg-vs-ico upgrade
      // case, but wrong here, where browsers use whichever matching icon comes
      // *last* and the light variant (no media condition) would then win even
      // in dark mode. Two plain `rel="icon"` entries, light first as the
      // fallback and dark second as the override, keep that ordering intact --
      // the same technique the root README's picture/source tags use for these
      // same two files.
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
      plugins: [starlightThemeRapide(), starlightSiteGraph()],
      sidebar: [
        {
          label: "Guides",
          items: [{ autogenerate: { directory: "docs" } }],
        },
      ],
    }),
    icon(),
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
