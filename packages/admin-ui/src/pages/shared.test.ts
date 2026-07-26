import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ErrorState, PageShell } from "./shared";

describe("ErrorState", () => {
  it("renders string errors as their message", () => {
    expect(renderToStaticMarkup(createElement(ErrorState, { error: "Form could not be reset" }))).toContain(
      "Form could not be reset",
    );
  });
});

describe("PageShell", () => {
  it("renders a shared page header and scroll body with consistent spacing", () => {
    const html = renderToStaticMarkup(
      createElement(
        PageShell,
        { title: "Tokens", description: "Create scoped automation tokens." },
        createElement("div", null, "Body"),
      ),
    );

    expect(html).toContain("grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-5");
    expect(html).toContain("Tokens");
    expect(html).toContain("Create scoped automation tokens.");
    expect(html).toContain("grid min-h-0 content-start gap-5 overflow-y-auto pr-1");
    expect(html).not.toContain("mb-5");
  });

  it("allows full-height pages to control body scrolling without changing header spacing", () => {
    const html = renderToStaticMarkup(
      createElement(
        PageShell,
        {
          title: "Repositories",
          description: "Manage repository visibility.",
          bodyClassName: "min-h-0 overflow-hidden",
        },
        createElement("div", null, "Repository grid"),
      ),
    );

    expect(html).toContain("grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-5");
    expect(html).toContain("min-h-0 overflow-hidden");
  });
});
