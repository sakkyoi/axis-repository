import { describe, expect, it } from "vitest";
import { dispatchRepositoryAdminResource, dispatchRepositoryClientHelper } from "@axis-repository/runtime-cloudflare/plugin-runtime";
import { MemoryRepositoryObjectStore } from "@axis-repository/runtime-cloudflare/plugin-runtime/testing";
import { createPypiPlugin, createPypiProxyPlugin, pypiProxyUpstreamUrl } from "./runtime";

function repositoryFixture() {
  return {
    id: "repo_1",
    name: "python-internal",
    ecosystem: "pypi",
    kind: "hosted" as const,
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
      expect.objectContaining({
        name: "twine-config",
        label: "twine upload",
        public: false,
        displayPath: "pypirc",
        handle: expect.any(Function),
      }),
    ]);
    expect(plugin.clientHelpers?.actions.find((action) => action.name === "simple-url")?.public).toBe(true);
    const response = await dispatchRepositoryClientHelper(plugin.clientHelpers!, {
      repository: {
        id: "repo_1",
        name: "python-internal",
        ecosystem: "pypi",
        kind: "hosted",
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

  it("serves a twine config helper with the Axis username", async () => {
    const plugin = createPypiPlugin();

    const response = await dispatchRepositoryClientHelper(plugin.clientHelpers!, {
      repository: repositoryFixture(),
      action: "twine-config",
      origin: "https://axis.example",
    });

    await expect(response?.json()).resolves.toEqual({
      repository: "python-internal",
      ecosystem: "pypi",
      uploadUrl: "https://axis.example/repositories/python-internal/legacy/",
      pypirc: [
        "[distutils]",
        "index-servers = python-internal",
        "",
        "[python-internal]",
        "repository = https://axis.example/repositories/python-internal/legacy/",
        "username = axis",
        "password = <PUBLISH_TOKEN>",
        "",
      ].join("\n"),
    });
  });

  it("resolves proxy Simple API paths against the configured upstream", () => {
    expect(pypiProxyUpstreamUrl("https://pypi.example/root/", "simple/"))
      .toBe("https://pypi.example/root/simple/");
    expect(pypiProxyUpstreamUrl("https://pypi.example/root/", "simple/demo/"))
      .toBe("https://pypi.example/root/simple/demo/");
    expect(pypiProxyUpstreamUrl("https://pypi.example/root/", "packages/demo/demo-1.0.whl"))
      .toBeNull();
  });

  it("forwards proxy Simple API requests to the configured upstream", async () => {
    const upstreamRequests: Request[] = [];
    const plugin = createPypiProxyPlugin({
      fetch: async (request) => {
        upstreamRequests.push(request);
        return new Response("<html>demo</html>", {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      },
    });

    const response = await plugin.serveRepositoryPath?.({
      repository: {
        ...repositoryFixture(),
        kind: "proxy",
        config: { pypi: { upstreamUrl: "https://pypi.example/root/" } },
      },
      request: new Request("https://axis.example/repositories/python-internal/simple/demo/", {
        headers: { accept: "text/html" },
      }),
      relativePath: "simple/demo/",
      accept: "text/html",
    });

    expect(upstreamRequests.map((request) => request.url)).toEqual([
      "https://pypi.example/root/simple/demo/",
    ]);
    expect(upstreamRequests[0]?.headers.get("accept")).toBe("text/html");
    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toBe("text/html; charset=utf-8");
    await expect(response?.text()).resolves.toBe("<html>demo</html>");
  });

  it("serves a Simple API URL client helper for proxy repositories", async () => {
    const plugin = createPypiProxyPlugin({
      fetch: async () => new Response(null),
    });

    expect(plugin.clientHelpers?.actions.map((action) => action.name)).toEqual(["simple-url"]);
    const response = await dispatchRepositoryClientHelper(plugin.clientHelpers!, {
      repository: {
        ...repositoryFixture(),
        kind: "proxy",
        config: { pypi: { upstreamUrl: "https://pypi.example/" } },
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

  it("rebuilds a proxy cache into artifact records", async () => {
    const upstreamHtml = new Map([
      ["https://pypi.example/simple/", "<a href=\"demo/\">demo</a>"],
      [
        "https://pypi.example/simple/demo/",
        `<a href="https://files.example/demo-1.0-py3-none-any.whl#sha256=${"a".repeat(64)}">demo-1.0-py3-none-any.whl</a>`,
      ],
    ]);
    const objectStore = new MemoryRepositoryObjectStore();
    const plugin = createPypiProxyPlugin({
      fetch: async (request) => new Response(upstreamHtml.get(request.url) ?? "", {
        status: upstreamHtml.has(request.url) ? 200 : 404,
        headers: { "content-type": "text/html" },
      }),
      objectStoreFor: () => objectStore,
    });
    const repository = {
      ...repositoryFixture(),
      kind: "proxy" as const,
      config: { pypi: { upstreamUrl: "https://pypi.example/" } },
    };

    const artifacts = await plugin.artifacts?.rebuildIndex({
      repository,
      objectStore,
      now: new Date("2026-08-05T00:00:00.000Z"),
    });

    expect(artifacts).toEqual([
      expect.objectContaining({
        repositoryName: "python-internal",
        ecosystem: "pypi",
        identity: "pypi:demo:demo-1.0-py3-none-any.whl",
        family: "pypi:demo",
        name: "demo",
        version: "1.0",
        summary: "demo 1.0",
        primaryObjectKey: `https://files.example/demo-1.0-py3-none-any.whl#sha256=${"a".repeat(64)}`,
        objectKeys: [`https://files.example/demo-1.0-py3-none-any.whl#sha256=${"a".repeat(64)}`],
        publishedAt: "2026-08-05T00:00:00.000Z",
        updatedAt: "2026-08-05T00:00:00.000Z",
      }),
    ]);

    const projectsResponse = await dispatchRepositoryAdminResource(plugin.adminResources!, {
      repositoryName: repository.name,
      repository,
      request: new Request("https://axis.example/admin/repositories/python-internal/pypi/projects"),
      path: ["projects"],
      services: {
        secrets: {
          createSecretValue: () => "secret",
          create: async () => {
            throw new Error("unused");
          },
          list: async () => [],
          get: async () => {
            throw new Error("unused");
          },
          getActive: async () => {
            throw new Error("unused");
          },
          revoke: async () => {
            throw new Error("unused");
          },
        },
      },
    });

    await expect(projectsResponse.json()).resolves.toEqual({
      projects: [
        {
          name: "demo",
          files: [
            expect.objectContaining({
              filename: "demo-1.0-py3-none-any.whl",
              sha256: "a".repeat(64),
            }),
          ],
        },
      ],
    });
  });
});
