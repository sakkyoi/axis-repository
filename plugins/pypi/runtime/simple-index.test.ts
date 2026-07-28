import { describe, expect, it } from "vitest";
import { MemoryRepositoryObjectStore } from "@axis-repository/runtime-cloudflare/plugin-runtime/testing";
import { parseProjectFilesHtml, readPublishedProjectFiles } from "./index-store";
import { resolveSimplePath } from "./layout";
import {
  renderProjectFilesHtml,
  renderProjectListHtml,
  type SimpleProjectFile,
} from "./simple-index";

const FILE: SimpleProjectFile = {
  filename: "my_project-1.0-py3-none-any.whl",
  sha256: "a".repeat(64),
  requiresPython: ">=3.9",
};

describe("renderProjectFilesHtml", () => {
  it("carries the hash of what each link points at", () => {
    // pip checks the download against this fragment; without it a corrupted or
    // substituted file installs silently.
    const html = renderProjectFilesHtml({ project: "my-project", files: [FILE] });

    expect(html).toContain(`#sha256=${"a".repeat(64)}`);
  });

  it("states the python requirement so pip can skip a file it cannot use", () => {
    const html = renderProjectFilesHtml({ project: "my-project", files: [FILE] });

    expect(html).toContain('data-requires-python="&gt;=3.9"');
  });

  it("links relative to the page, so any origin serves it", () => {
    // An absolute link would bake in whichever hostname happened to generate
    // the page, and break behind a different one.
    const html = renderProjectFilesHtml({ project: "my-project", files: [FILE] });

    expect(html).toContain('href="../../packages/my-project/my_project-1.0-py3-none-any.whl#sha256=');
    expect(html).not.toContain("http://");
    expect(html).not.toContain("https://");
  });

  it("escapes a python requirement rather than letting it close the attribute", () => {
    // Requires-Python is copied out of package metadata unchanged, and an
    // uploader controls it.
    const html = renderProjectFilesHtml({
      project: "evil",
      files: [{ filename: "evil-1.0.tar.gz", sha256: "b".repeat(64), requiresPython: '">< script' }],
    });

    expect(html).not.toContain('"><');
    expect(html).toContain("&quot;&gt;&lt;");
  });

  it("lists files in a stable order", () => {
    const first = renderProjectFilesHtml({
      project: "p",
      files: [
        { filename: "p-2.0.tar.gz", sha256: "b".repeat(64) },
        { filename: "p-1.0.tar.gz", sha256: "a".repeat(64) },
      ],
    });
    const second = renderProjectFilesHtml({
      project: "p",
      files: [
        { filename: "p-1.0.tar.gz", sha256: "a".repeat(64) },
        { filename: "p-2.0.tar.gz", sha256: "b".repeat(64) },
      ],
    });

    expect(first).toBe(second);
  });
});

describe("the index reading itself back", () => {
  it("recovers every field it wrote", async () => {
    // Publishing merges into what is already listed, so a page has to survive
    // a round trip: anything lost here is dropped from the next publish.
    const html = renderProjectFilesHtml({
      project: "my-project",
      files: [FILE, { filename: "my-project-0.9.tar.gz", sha256: "c".repeat(64) }],
    });

    const recovered = parseProjectFilesHtml(html);

    expect([...recovered].sort((left, right) => left.filename.localeCompare(right.filename)))
      .toEqual([FILE, { filename: "my-project-0.9.tar.gz", sha256: "c".repeat(64) }]
        .sort((left, right) => left.filename.localeCompare(right.filename)));
  });

  it("reads back a page stored for a project", async () => {
    const objectStore = new MemoryRepositoryObjectStore();
    await objectStore.putText(
      "repositories/python-internal/simple/my-project/index.html",
      renderProjectFilesHtml({ project: "my-project", files: [FILE] }),
      "text/html; charset=utf-8",
    );

    await expect(readPublishedProjectFiles({
      objectStore,
      repositoryName: "python-internal",
      project: "my-project",
    })).resolves.toEqual([FILE]);
  });

  it("reports no files for a project that has no page yet", async () => {
    await expect(readPublishedProjectFiles({
      objectStore: new MemoryRepositoryObjectStore(),
      repositoryName: "python-internal",
      project: "absent",
    })).resolves.toEqual([]);
  });
});

describe("renderProjectListHtml", () => {
  it("links each project to its own page", () => {
    const html = renderProjectListHtml(["beta", "alpha"]);

    expect(html).toContain('<a href="alpha/">alpha</a>');
    expect(html).toContain('<a href="beta/">beta</a>');
    expect(html.indexOf("alpha")).toBeLessThan(html.indexOf("beta"));
  });
});

describe("resolveSimplePath", () => {
  it.each([
    ["simple/", "simple/index.html"],
    ["simple", "simple/index.html"],
    ["simple/my-project/", "simple/my-project/index.html"],
    ["simple/my-project", "simple/my-project/index.html"],
  ])("resolves %s to %s", (requested, expected) => {
    // PEP 503 addresses directories, which are not object keys.
    expect(resolveSimplePath(requested)).toEqual({ objectPath: expected });
  });

  it("leaves a package path alone", () => {
    expect(resolveSimplePath("packages/my-project/my_project-1.0-py3-none-any.whl"))
      .toEqual({ objectPath: "packages/my-project/my_project-1.0-py3-none-any.whl" });
  });

  it("refuses a trailing slash on something that is not an index", () => {
    expect(resolveSimplePath("packages/my-project/")).toBeNull();
  });
});
