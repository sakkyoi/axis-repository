import { describe, expect, it } from "vitest";
import { MemoryRepositoryObjectStore } from "@axis-repository/runtime-cloudflare/plugin-runtime/testing";
import { createPypiAdminResources } from "./admin-resources";
import { readPublishedProjectFiles, writeSimpleIndexes } from "./index-store";
import { renderProjectFilesHtml, renderProjectFilesJson } from "./simple-index";

const FILE = { filename: "alpha-1.0.tar.gz", sha256: "a".repeat(64) };

async function harness() {
  const objectStore = new MemoryRepositoryObjectStore();
  await writeSimpleIndexes({
    objectStore,
    repositoryName: "python-internal",
    projects: [{ project: "alpha", files: [FILE, { filename: "alpha-2.0.tar.gz", sha256: "b".repeat(64) }] }],
  });
  const resources = createPypiAdminResources({ objectStoreFor: () => objectStore });

  async function call(action: string, filename: string, body?: unknown) {
    const route = resources.routes.find((candidate) => candidate.name === action)!;
    return route.handle({
      repositoryName: "python-internal",
      params: { project: "alpha", filename },
      request: new Request("https://axis.example/", {
        method: "POST",
        ...(body === undefined
          ? {}
          : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      }),
    } as never);
  }

  return {
    objectStore,
    call,
    files: () => readPublishedProjectFiles({ objectStore, repositoryName: "python-internal", project: "alpha" }),
    stored: (key: string) => {
      const value = [...objectStore.objects].reverse().find((object) => object.key === key)?.value;
      return typeof value === "string" ? value : undefined;
    },
  };
}

describe("yanking a file", () => {
  it("marks it in the index with the reason given", async () => {
    const pypi = await harness();

    await pypi.call("yank-file", "alpha-1.0.tar.gz", { reason: "broken sdist" });

    expect(await pypi.files()).toContainEqual({ ...FILE, yanked: "broken sdist" });
  });

  it("leaves the file itself downloadable", async () => {
    // The whole point of yanking rather than deleting: anything that already
    // pins this version keeps working.
    const pypi = await harness();

    await pypi.call("yank-file", "alpha-1.0.tar.gz", { reason: "broken" });

    const html = pypi.stored("repositories/python-internal/simple/alpha/index.html") ?? "";
    expect(html).toContain("alpha-1.0.tar.gz");
    expect(html).toContain("#sha256=");
  });

  it("records a yank with no reason as a yank all the same", async () => {
    // PEP 592 distinguishes an absent data-yanked from an empty one, so the
    // empty string cannot be dropped as falsy along the way.
    const pypi = await harness();

    await pypi.call("yank-file", "alpha-1.0.tar.gz");

    expect(await pypi.files()).toContainEqual({ ...FILE, yanked: "" });
    const json = JSON.parse(pypi.stored("repositories/python-internal/simple/alpha/index.v1.json") ?? "{}") as {
      files: Array<{ filename: string; yanked?: unknown }>;
    };
    expect(json.files.find((file) => file.filename === "alpha-1.0.tar.gz")?.yanked).toBe(true);
  });

  it("leaves the project's other files alone", async () => {
    const pypi = await harness();

    await pypi.call("yank-file", "alpha-1.0.tar.gz", { reason: "broken" });

    const other = (await pypi.files()).find((file) => file.filename === "alpha-2.0.tar.gz");
    expect(other?.yanked).toBeUndefined();
  });

  it("can be undone", async () => {
    const pypi = await harness();
    await pypi.call("yank-file", "alpha-1.0.tar.gz", { reason: "broken" });

    await pypi.call("unyank-file", "alpha-1.0.tar.gz");

    expect(await pypi.files()).toContainEqual(FILE);
    expect(pypi.stored("repositories/python-internal/simple/alpha/index.html"))
      .not.toContain("data-yanked");
  });

  it("reports a file the project does not list", async () => {
    const pypi = await harness();

    await expect(pypi.call("yank-file", "absent-9.9.tar.gz", { reason: "x" })).rejects.toThrow();
  });
});

describe("a yanked file in each serialization", () => {
  const yanked = [{ ...FILE, yanked: "broken" }];

  it("carries the reason in HTML", () => {
    expect(renderProjectFilesHtml({ project: "alpha", files: yanked }))
      .toContain('data-yanked="broken"');
  });

  it("carries the reason in JSON", () => {
    const parsed = JSON.parse(renderProjectFilesJson({ project: "alpha", files: yanked })) as {
      files: Array<{ yanked?: unknown }>;
    };

    expect(parsed.files[0]?.yanked).toBe("broken");
  });

  it("says nothing at all when a file is not yanked", () => {
    // An unconditional attribute would yank everything.
    expect(renderProjectFilesHtml({ project: "alpha", files: [FILE] })).not.toContain("data-yanked");
    const parsed = JSON.parse(renderProjectFilesJson({ project: "alpha", files: [FILE] })) as {
      files: Array<Record<string, unknown>>;
    };
    expect(parsed.files[0]).not.toHaveProperty("yanked");
  });
});
