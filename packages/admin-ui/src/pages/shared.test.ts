import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ErrorState, NotFoundState, PageShell } from "./shared";

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

describe("a page with nothing to describe", () => {
  it("says nothing rather than keeping the description it would have had", () => {
    // A page that 404s used to keep the description written for the page it
    // would have been, promising what it could not show.
    const html = renderToStaticMarkup(createElement(PageShell, { title: "Repository" }));

    expect(html).toContain("Repository");
    expect(html).not.toContain("<p");
  });
});

describe("NotFoundState", () => {
  it("carries a way back out", () => {
    // Reached by a stale link or a typo, so leaving it has to be possible
    // without the browser's back button.
    const html = renderToStaticMarkup(
      createElement(NotFoundState, {
        title: "Repository not found",
        description: "Nothing here is named a.",
        action: createElement("a", { href: "/ui/repositories" }, "Repositories"),
      }),
    );

    expect(html).toContain("Repository not found");
    expect(html).toContain("Nothing here is named a.");
    expect(html).toContain("href=\"/ui/repositories\"");
  });

  it("brings its own frame, being what stands in for the panel", () => {
    const html = renderToStaticMarkup(
      createElement(NotFoundState, { title: "Repository not found", description: "Nothing here is named a." }),
    );

    expect(html).toContain("border-dashed");
  });
});
