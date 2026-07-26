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
  it("renders the title, description, and body", () => {
    const html = renderToStaticMarkup(
      createElement(
        PageShell,
        { title: "Tokens", description: "Create scoped automation tokens." },
        createElement("div", null, "Body"),
      ),
    );

    expect(html).toContain("Tokens");
    expect(html).toContain("Create scoped automation tokens.");
    expect(html).toContain("Body");
  });

  it("lets a page override the body class", () => {
    const html = renderToStaticMarkup(
      createElement(
        PageShell,
        {
          title: "Repositories",
          description: "Manage repository visibility.",
          bodyClassName: "min-h-0 content-stretch overflow-hidden",
        },
        createElement("div", null, "Repository grid"),
      ),
    );

    // A caller-supplied body class replaces the default rather than merging.
    expect(html).toContain("min-h-0 content-stretch overflow-hidden");
    expect(html).not.toContain("content-start");
    expect(html).toContain("Repository grid");
  });
});
