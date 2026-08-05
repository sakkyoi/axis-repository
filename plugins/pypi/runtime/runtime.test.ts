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

function unusedSecrets() {
  return {
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
    expect(pypiProxyUpstreamUrl("https://pypi.nvidia.com/", "simple/"))
      .toBe("https://pypi.nvidia.com/");
    expect(pypiProxyUpstreamUrl("https://pypi.nvidia.com/", "simple/demo/"))
      .toBe("https://pypi.nvidia.com/demo/");
    expect(pypiProxyUpstreamUrl("https://pypi.org/", "simple/"))
      .toBe("https://pypi.org/simple/");
    expect(pypiProxyUpstreamUrl("https://pypi.org/simple/", "simple/demo/"))
      .toBe("https://pypi.org/simple/demo/");
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
      ["https://pypi.org/simple/", "<a href=\"demo/\">demo</a>"],
      [
        "https://pypi.org/simple/demo/",
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
      config: { pypi: { upstreamUrl: "https://pypi.org/" } },
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

    await expect(projectsResponse.json()).resolves.toMatchObject({
      projects: [{ name: "demo", fileCount: 1 }],
      truncated: false,
    });

    const projectResponse = await dispatchRepositoryAdminResource(plugin.adminResources!, {
      repositoryName: repository.name,
      repository,
      request: new Request("https://axis.example/admin/repositories/python-internal/pypi/projects/demo"),
      path: ["projects", "demo"],
      services: { secrets: unusedSecrets() },
    });
    await expect(projectResponse.json()).resolves.toMatchObject({
      project: {
        name: "demo",
        files: [
          expect.objectContaining({
            filename: "demo-1.0-py3-none-any.whl",
            sha256: "a".repeat(64),
          }),
        ],
      },
    });
  });

  it("paginates proxy cached projects", async () => {
    const objectStore = new MemoryRepositoryObjectStore();
    await objectStore.putJson("repositories/python-internal/_proxy-cache/pypi/projects.json", {
      projects: [
        { name: "alpha", files: [] },
        { name: "bravo", files: [] },
        { name: "charlie", files: [] },
      ],
    });
    const plugin = createPypiProxyPlugin({ objectStoreFor: () => objectStore });
    const repository = {
      ...repositoryFixture(),
      kind: "proxy" as const,
      config: { pypi: { upstreamUrl: "https://pypi.org/" } },
    };

    const firstPage = await dispatchRepositoryAdminResource(plugin.adminResources!, {
      repositoryName: repository.name,
      repository,
      request: new Request("https://axis.example/admin/repositories/python-internal/pypi/projects?limit=2"),
      path: ["projects"],
      services: { secrets: unusedSecrets() },
    });
    const firstPageBody = await firstPage.json() as { cursor?: string };
    expect(firstPageBody).toMatchObject({
      projects: [{ name: "alpha" }, { name: "bravo" }],
      truncated: true,
      cursor: expect.any(String),
    });

    const secondPage = await dispatchRepositoryAdminResource(plugin.adminResources!, {
      repositoryName: repository.name,
      repository,
      request: new Request(`https://axis.example/admin/repositories/python-internal/pypi/projects?limit=2&cursor=${encodeURIComponent(firstPageBody.cursor ?? "")}`),
      path: ["projects"],
      services: { secrets: unusedSecrets() },
    });
    await expect(secondPage.json()).resolves.toMatchObject({
      projects: [{ name: "charlie" }],
      truncated: false,
    });

    const detail = await dispatchRepositoryAdminResource(plugin.adminResources!, {
      repositoryName: repository.name,
      repository,
      request: new Request("https://axis.example/admin/repositories/python-internal/pypi/projects/alpha"),
      path: ["projects", "alpha"],
      services: { secrets: unusedSecrets() },
    });
    await expect(detail.json()).resolves.toMatchObject({
      project: { name: "alpha", files: [] },
    });
  });

  it("exposes a virtual object browser for proxy cached projects", async () => {
    const objectStore = new MemoryRepositoryObjectStore();
    await objectStore.putJson("repositories/python-internal/_proxy-cache/pypi/projects.json", {
      projects: [
        {
          name: "demo",
          files: [{
            filename: "demo-1.0-py3-none-any.whl",
            url: "https://files.example/demo-1.0-py3-none-any.whl",
          }],
        },
      ],
    });
    const plugin = createPypiProxyPlugin({ objectStoreFor: () => objectStore });
    const repository = {
      ...repositoryFixture(),
      kind: "proxy" as const,
      config: { pypi: { upstreamUrl: "https://pypi.org/" } },
    };

    await expect(plugin.objectBrowser?.listObjects({ repository, objectStore, prefix: "" }))
      .resolves.toEqual({
        prefix: "",
        directories: [{ name: "simple", path: "simple/" }],
        objects: [],
        truncated: false,
      });
    await expect(plugin.objectBrowser?.listObjects({ repository, objectStore, prefix: "simple/" }))
      .resolves.toMatchObject({
        prefix: "simple/",
        directories: [{ name: "demo", path: "simple/demo/" }],
        objects: [],
        truncated: false,
      });
    await expect(plugin.objectBrowser?.listObjects({ repository, objectStore, prefix: "simple/demo/" }))
      .resolves.toMatchObject({
        prefix: "simple/demo/",
        directories: [],
        objects: [{
          name: "demo-1.0-py3-none-any.whl",
          path: "simple/demo/demo-1.0-py3-none-any.whl",
          contentType: "application/octet-stream",
        }],
        truncated: false,
      });
    await expect(plugin.objectBrowser?.getObjectDetail?.({
      repository,
      objectStore,
      path: "simple/demo/demo-1.0-py3-none-any.whl",
      origin: "https://axis.example",
    })).resolves.toMatchObject({
      name: "demo-1.0-py3-none-any.whl",
      path: "simple/demo/demo-1.0-py3-none-any.whl",
      objectKey: "virtual:pypi-proxy:simple/demo/demo-1.0-py3-none-any.whl",
      repositoryUrl: "https://axis.example/repositories/python-internal/simple/demo/demo-1.0-py3-none-any.whl",
    });
  });

  it("paginates hosted projects before reading project files", async () => {
    const objectStore = new MemoryRepositoryObjectStore();
    const plugin = createPypiPlugin({ objectStoreFor: () => objectStore });
    for (const project of ["alpha", "bravo", "charlie"]) {
      await objectStore.putBytes(
        `repositories/python-internal/packages/${project}/${project}-1.0-py3-none-any.whl`,
        new Uint8Array([1]),
        "application/octet-stream",
      );
      await objectStore.putText(
        `repositories/python-internal/simple/${project}/index.html`,
        `<a href="../../packages/${project}/${project}-1.0-py3-none-any.whl#sha256=${"a".repeat(64)}">${project}-1.0-py3-none-any.whl</a>`,
        "text/html; charset=utf-8",
      );
    }

    const response = await dispatchRepositoryAdminResource(plugin.adminResources!, {
      repositoryName: "python-internal",
      repository: repositoryFixture(),
      request: new Request("https://axis.example/admin/repositories/python-internal/pypi/projects?limit=2"),
      path: ["projects"],
      services: { secrets: unusedSecrets() },
    });

    await expect(response.json()).resolves.toMatchObject({
      projects: [
        { name: "alpha" },
        { name: "bravo" },
      ],
      truncated: true,
      cursor: expect.any(String),
    });

    const detail = await dispatchRepositoryAdminResource(plugin.adminResources!, {
      repositoryName: "python-internal",
      repository: repositoryFixture(),
      request: new Request("https://axis.example/admin/repositories/python-internal/pypi/projects/alpha"),
      path: ["projects", "alpha"],
      services: { secrets: unusedSecrets() },
    });
    await expect(detail.json()).resolves.toMatchObject({
      project: { name: "alpha", files: [{ filename: "alpha-1.0-py3-none-any.whl" }] },
    });
  });

  it("fetches proxy project pages with bounded concurrency", async () => {
    const projectNames = Array.from({ length: 20 }, (_, index) => `demo-${index}`);
    let activeProjectRequests = 0;
    let maxActiveProjectRequests = 0;
    const plugin = createPypiProxyPlugin({
      fetch: async (request) => {
        if (request.url === "https://pypi.org/simple/") {
          return new Response(projectNames.map((project) => `<a href="${project}/">${project}</a>`).join(""));
        }
        activeProjectRequests += 1;
        maxActiveProjectRequests = Math.max(maxActiveProjectRequests, activeProjectRequests);
        await Promise.resolve();
        activeProjectRequests -= 1;
        const project = request.url.replace(/^https:\/\/pypi\.org\/simple\/|\/$/g, "");
        return new Response(
          `<a href="${project}-1.0-py3-none-any.whl#sha256=${"a".repeat(64)}">${project}-1.0-py3-none-any.whl</a>`,
        );
      },
    });

    await plugin.artifacts?.rebuildIndex({
      repository: {
        ...repositoryFixture(),
        kind: "proxy",
        config: { pypi: { upstreamUrl: "https://pypi.org/" } },
      },
      objectStore: new MemoryRepositoryObjectStore(),
      now: new Date("2026-08-05T00:00:00.000Z"),
    });

    expect(maxActiveProjectRequests).toBeGreaterThan(1);
    expect(maxActiveProjectRequests).toBeLessThanOrEqual(8);
  });

  it("skips proxy project pages that fail with network errors", async () => {
    const plugin = createPypiProxyPlugin({
      fetch: async (request) => {
        if (request.url === "https://pypi.org/simple/") {
          return new Response([
            "<a href=\"broken/\">broken</a>",
            "<a href=\"demo/\">demo</a>",
          ].join(""));
        }
        if (request.url === "https://pypi.org/simple/broken/") {
          throw new TypeError("terminated");
        }
        return new Response(
          `<a href="demo-1.0-py3-none-any.whl#sha256=${"a".repeat(64)}">demo-1.0-py3-none-any.whl</a>`,
        );
      },
    });

    const artifacts = await plugin.artifacts?.rebuildIndex({
      repository: {
        ...repositoryFixture(),
        kind: "proxy",
        config: { pypi: { upstreamUrl: "https://pypi.org/" } },
      },
      objectStore: new MemoryRepositoryObjectStore(),
      now: new Date("2026-08-05T00:00:00.000Z"),
    });

    expect(artifacts).toEqual([
      expect.objectContaining({ identity: "pypi:demo:demo-1.0-py3-none-any.whl" }),
    ]);
  });
});
