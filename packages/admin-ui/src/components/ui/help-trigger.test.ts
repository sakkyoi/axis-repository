import { createElement } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HelpTrigger } from "./help-trigger";

describe("HelpTrigger", () => {
  it("renders tooltip help without native browser title tooltips", () => {
    const html = renderToStaticMarkup(
      createElement(
        HelpTrigger,
        {
          label: "Repository plugin availability help",
          variant: "tooltip",
          children: "Repository plugin availability is resolved from catalog policy.",
        },
      ),
    );

    expect(html).toContain("Repository plugin availability help");
    expect(html).toContain("aria-describedby");
    expect(html).toContain("Repository plugin availability is resolved from catalog policy.");
    expect(html).toContain("group-hover:block");
    expect(html).not.toContain("title=");
  });

  it("supports dialog help for longer content", () => {
    const source = readFileSync(join(import.meta.dirname, "help-trigger.tsx"), "utf8");

    expect(source).toContain('variant === "dialog"');
    expect(source).toContain("<Dialog");
    expect(source).toContain("<DialogTitle");
  });
});
