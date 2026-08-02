import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import tailwind from "@astrojs/tailwind";

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
          autogenerate: { directory: "docs" },
        },
      ],
    }),
    // applyBaseStyles: false -- Tailwind's base stylesheet resets margins,
    // headings, and typography, which fights Starlight's own docs styling.
    // Left off globally, the Tailwind reset is imported only by the
    // marketing layout (Task 3), never by Starlight's pages.
    tailwind({ applyBaseStyles: false }),
  ],
});
