import { describe, expect, it } from "vitest";
import { dispatchRepositoryClientHelper } from "@axis-repository/runtime-cloudflare/plugin-runtime";
import { createPypiPlugin } from "./runtime";

function repositoryFixture() {
  return {
    id: "repo_1",
    name: "python-internal",
    ecosystem: "pypi",
    visibility: "private" as const,
    config: {},
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
  };
}

describe("PyPI plugin lifecycle", () => {
  it("allows empty PyPI repository config", () => {
    const plugin = createPypiPlugin();

    expect(() =>
      plugin.validateRepositoryConfig({
        ecosystem: "pypi",
        config: {},
      }),
    ).not.toThrow();
    expect(() =>
      plugin.validateRepositoryConfig({
        ecosystem: "pypi",
        config: { pypi: {} },
      }),
    ).not.toThrow();
  });

  it("serves both the index and the files it points at", () => {
    // An index whose links cannot be fetched is no better than no index: pip
    // reads simple/, then downloads from packages/.
    const plugin = createPypiPlugin();

    expect(plugin.canServeRepositoryPath({ relativePath: "simple" })).toBe(true);
    expect(plugin.canServeRepositoryPath({ relativePath: "simple/my-package/" })).toBe(true);
    expect(plugin.canServeRepositoryPath({ relativePath: "packages/my-package/my_package-1.0-py3-none-any.whl" }))
      .toBe(true);
  });

  it("does not serve staged uploads", () => {
    // Staging is scoped to a publish session and is not part of what the
    // repository publishes; serving it would expose files that were uploaded
    // but never finalized.
    const plugin = createPypiPlugin();

    expect(plugin.canServeRepositoryPath({ relativePath: "_staging/uploads/sess_1/upl_1/x.whl" })).toBe(false);
    expect(plugin.canServeRepositoryPath({ relativePath: "publishes/sess_1.json" })).toBe(false);
  });

  it("refuses to publish a file that is not a distribution", () => {
    // The filename decides which project page a file appears on. Accepting one
    // that cannot be parsed would store a file no index can ever list.
    const plugin = createPypiPlugin();
    const validate = (filename: string) => () => plugin.publish.validateArtifacts({
      repository: repositoryFixture(),
      artifacts: [{
        filename,
        size: 1,
        sha256: "a".repeat(64),
        contentType: "application/octet-stream",
        metadata: {},
      }],
    });

    expect(validate("notes.txt")).toThrow(/not a wheel or source distribution/);
    expect(validate("..-1.0.tar.gz")).toThrow(/not a wheel or source distribution/);
    expect(validate("simple-1.0-py3-none-any.whl")).not.toThrow();
    expect(validate("simple-1.0.tar.gz")).not.toThrow();
  });

  it("serves a simple API URL client helper", async () => {
    const plugin = createPypiPlugin();

    expect(plugin.clientHelpers?.namespace).toBe("pypi");
    expect(plugin.clientHelpers?.actions).toEqual([
      expect.objectContaining({
        name: "simple-url",
        label: "Simple API URL",
        responseKind: "text",
        defaultOpen: true,
        public: true,
        displayPath: "simpleUrl",
        handle: expect.any(Function),
      }),
    ]);
    expect(plugin.clientHelpers?.actions.find((action) => action.name === "simple-url")?.public).toBe(true);
    const response = await dispatchRepositoryClientHelper(plugin.clientHelpers!, {
      repository: {
        id: "repo_1",
        name: "python-internal",
        ecosystem: "pypi",
        visibility: "private",
        config: {},
        createdAt: "2026-07-18T00:00:00.000Z",
        updatedAt: "2026-07-18T00:00:00.000Z",
      },
      action: "simple-url",
      origin: "https://axis.example",
    });

    await expect(response?.json()).resolves.toEqual({
      repository: "python-internal",
      ecosystem: "pypi",
      simpleUrl: "https://axis.example/repositories/python-internal/simple/",
      pipIndexUrl: "https://axis.example/repositories/python-internal/simple/",
    });
  });
});
