import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  integrations: [
    starlight({
      title: "Axis Repository",
      components: {
        Header: "./src/components/StarlightHeader.astro",
      },
      sidebar: [
        {
          label: "Guides",
          items: [{ autogenerate: { directory: "docs" } }],
        },
      ],
    }),
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
