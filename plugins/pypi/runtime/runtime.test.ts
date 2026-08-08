import { describe, expect, it, vi } from "vitest";
import type { RepositoryArtifactStore } from "@axis-repository/core";
import { dispatchRepositoryAdminResource, dispatchRepositoryClientHelper, objectBytes } from "@axis-repository/runtime-cloudflare/plugin-runtime";
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

  it("proxies cached PyPI proxy file paths through Axis repository URLs", async () => {
    const objectStore = new MemoryRepositoryObjectStore();
    await objectStore.putJson("repositories/python-internal/_proxy-cache/pypi/projects/demo.json", {
      name: "demo",
      files: [{
        filename: "demo-1.0-py3-none-any.whl",
        url: "https://files.example/packages/demo-1.0-py3-none-any.whl",
      }],
    });
    const upstreamRequests: Request[] = [];
    const plugin = createPypiProxyPlugin({
      objectStoreFor: () => objectStore,
      fetch: async (request) => {
        upstreamRequests.push(request);
        return new Response("wheel bytes", {
          headers: { "content-type": "application/octet-stream" },
        });
      },
    });

    const response = await plugin.serveRepositoryPath?.({
      repository: {
        ...repositoryFixture(),
        kind: "proxy",
        config: { pypi: { upstreamUrl: "https://pypi.example/root/" } },
      },
      request: new Request("https://axis.example/repositories/python-internal/simple/demo/demo-1.0-py3-none-any.whl"),
      relativePath: "simple/demo/demo-1.0-py3-none-any.whl",
    });

    expect(upstreamRequests.map((request) => request.url)).toEqual([
      "https://files.example/packages/demo-1.0-py3-none-any.whl",
    ]);
    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toBe("application/octet-stream");
    await expect(response?.text()).resolves.toBe("wheel bytes");
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

  it("refreshes a proxy catalog without fetching project detail pages", async () => {
    const upstreamHtml = new Map([
      ["https://pypi.org/simple/", "<a href=\"demo/\">demo</a>"],
      [
        "https://pypi.org/simple/demo/",
        `<a href="https://files.example/demo-1.0-py3-none-any.whl#sha256=${"a".repeat(64)}">demo-1.0-py3-none-any.whl</a>`,
      ],
    ]);
    const fetchedUrls: string[] = [];
    const objectStore = new MemoryRepositoryObjectStore();
    const plugin = createPypiProxyPlugin({
      fetch: async (request) => {
        fetchedUrls.push(request.url);
        return new Response(upstreamHtml.get(request.url) ?? "", {
          status: upstreamHtml.has(request.url) ? 200 : 404,
          headers: { "content-type": "text/html" },
        });
      },
      objectStoreFor: () => objectStore,
    });
    const repository = {
      ...repositoryFixture(),
      kind: "proxy" as const,
      config: { pypi: { upstreamUrl: "https://pypi.org/" } },
    };

    await expect(plugin.artifacts?.rebuildIndex({
      repository,
      objectStore,
      now: new Date("2026-08-05T00:00:00.000Z"),
    })).resolves.toMatchObject({
      artifacts: [
        expect.objectContaining({
          id: "artifact_python-internal_pypi_proxy_project_demo",
          repositoryName: "python-internal",
          ecosystem: "pypi",
          identity: "pypi:proxy-project:demo",
          family: "pypi:proxy-project:demo",
          name: "demo",
          summary: "demo",
          objectKeys: [],
          metadata: {
            source: "proxy",
            project: "demo",
            upstreamUrl: "https://pypi.org/simple/demo/",
          },
          publishedAt: "2026-08-05T00:00:00.000Z",
          updatedAt: "2026-08-05T00:00:00.000Z",
        }),
      ],
      complete: false,
      continuation: { projectDetailOffset: 0 },
      progress: { current: 1, total: 2, message: "Project catalog indexed. Warming 1 project details" },
    });
    expect(fetchedUrls).toEqual(["https://pypi.org/simple/"]);

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
      projects: [{ name: "demo" }],
      truncated: false,
    });

    await expect(objectStore.getObject("repositories/python-internal/_proxy-cache/pypi/projects/demo.json"))
      .resolves.toBeNull();
  });

  it("fetches and caches proxy project details on demand", async () => {
    const upstreamHtml = new Map([
      ["https://pypi.org/simple/", "<a href=\"demo/\">demo</a>"],
      [
        "https://pypi.org/simple/demo/",
        `<a href="https://files.example/demo-1.0-py3-none-any.whl#sha256=${"a".repeat(64)}">demo-1.0-py3-none-any.whl</a>`,
      ],
    ]);
    const fetchedUrls: string[] = [];
    const objectStore = new MemoryRepositoryObjectStore();
    const plugin = createPypiProxyPlugin({
      fetch: async (request) => {
        fetchedUrls.push(request.url);
        return new Response(upstreamHtml.get(request.url) ?? "", {
          status: upstreamHtml.has(request.url) ? 200 : 404,
          headers: { "content-type": "text/html" },
        });
      },
      objectStoreFor: () => objectStore,
    });
    const repository = {
      ...repositoryFixture(),
      kind: "proxy" as const,
      config: { pypi: { upstreamUrl: "https://pypi.org/" } },
    };

    await plugin.artifacts?.rebuildIndex({
      repository,
      objectStore,
      now: new Date("2026-08-05T00:00:00.000Z"),
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
    expect(fetchedUrls).toEqual(["https://pypi.org/simple/", "https://pypi.org/simple/demo/"]);

    const manifest = await objectStore.getObject("repositories/python-internal/_proxy-cache/pypi/projects.json");
    expect(manifest).not.toBeNull();
    expect(JSON.parse(new TextDecoder().decode(await objectBytes(manifest!)))).toEqual({
      upstreamUrl: "https://pypi.org/",
      refreshedAt: "2026-08-05T00:00:00.000Z",
      projects: [{ name: "demo", fileCount: 1 }],
    });
    await expect(objectStore.getObject("repositories/python-internal/_proxy-cache/pypi/projects/demo.json")).resolves.not.toBeNull();
  });

  it("refreshes proxy catalogs in a single root index fetch", async () => {
    const projectNames = Array.from({ length: 7 }, (_, index) => `demo-${String(index + 1).padStart(2, "0")}`);
    const upstreamHtml = new Map<string, string>([
      ["https://pypi.org/simple/", projectNames.map((project) => `<a href="${project}/">${project}</a>`).join("")],
      ...projectNames.map((project, index) => [
        `https://pypi.org/simple/${project}/`,
        `<a href="${project}-1.0-py3-none-any.whl#sha256=${String(index).padStart(64, "a")}">${project}-1.0-py3-none-any.whl</a>`,
      ] as const),
    ]);
    const fetchedUrls: string[] = [];
    const objectStore = new MemoryRepositoryObjectStore();
    const plugin = createPypiProxyPlugin({
      fetch: async (request) => {
        fetchedUrls.push(request.url);
        return new Response(upstreamHtml.get(request.url) ?? "", {
          status: upstreamHtml.has(request.url) ? 200 : 404,
          headers: { "content-type": "text/html" },
        });
      },
      objectStoreFor: () => objectStore,
    });
    const repository = {
      ...repositoryFixture(),
      kind: "proxy" as const,
      config: { pypi: { upstreamUrl: "https://pypi.org/" } },
    };

    await expect(plugin.artifacts?.rebuildIndex({
      repository,
      objectStore,
      now: new Date("2026-08-05T00:00:00.000Z"),
    })).resolves.toMatchObject({
      artifacts: expect.arrayContaining(
        projectNames.map((project) => expect.objectContaining({ identity: `pypi:proxy-project:${project}` })),
      ),
      complete: false,
      continuation: { projectDetailOffset: 0 },
    });
    expect(fetchedUrls).toEqual(["https://pypi.org/simple/"]);
  });

  it("chunks large proxy catalog marker indexing with continuation", async () => {
    const projectNames = Array.from({ length: 125 }, (_, index) => `demo-${String(index + 1).padStart(3, "0")}`);
    const fetchedUrls: string[] = [];
    const objectStore = new MemoryRepositoryObjectStore();
    const plugin = createPypiProxyPlugin({
      fetch: async (request) => {
        fetchedUrls.push(request.url);
        return new Response(projectNames.map((project) => `<a href="${project}/">${project}</a>`).join(""), {
          headers: { "content-type": "text/html" },
        });
      },
      objectStoreFor: () => objectStore,
    });
    const repository = {
      ...repositoryFixture(),
      kind: "proxy" as const,
      config: { pypi: { upstreamUrl: "https://pypi.org/" } },
    };

    const first = await plugin.artifacts?.rebuildIndex({
      repository,
      objectStore,
      now: new Date("2026-08-05T00:00:00.000Z"),
    });
    expect(first).toMatchObject({
      artifacts: expect.arrayContaining([
        expect.objectContaining({ identity: "pypi:proxy-project:demo-001" }),
        expect.objectContaining({ identity: "pypi:proxy-project:demo-100" }),
      ]),
      complete: false,
      continuation: { projectOffset: 100 },
      progress: { current: 100, total: 250 },
    });

    const second = await plugin.artifacts?.rebuildIndex({
      repository,
      objectStore,
      now: new Date("2026-08-05T00:00:01.000Z"),
      continuation: { projectOffset: 100 },
    });
    expect(second).toMatchObject({
      artifacts: expect.arrayContaining([
        expect.objectContaining({ identity: "pypi:proxy-project:demo-101" }),
        expect.objectContaining({ identity: "pypi:proxy-project:demo-125" }),
      ]),
      complete: false,
      continuation: { projectDetailOffset: 0 },
      progress: { current: 125, total: 250 },
    });
    expect(fetchedUrls).toEqual(["https://pypi.org/simple/"]);
  });

  it("warms proxy project details inside the repository index job after catalog marker indexing", async () => {
    const projectNames = ["alpha", "bravo", "charlie"];
    const upstreamHtml = new Map<string, string>([
      ["https://pypi.org/simple/", projectNames.map((project) => `<a href="${project}/">${project}</a>`).join("")],
      ...projectNames.map((project) => [
        `https://pypi.org/simple/${project}/`,
        `<a href="${project}-1.0-py3-none-any.whl#sha256=${"a".repeat(64)}">${project}-1.0-py3-none-any.whl</a>`,
      ] as const),
    ]);
    const fetchedUrls: string[] = [];
    const objectStore = new MemoryRepositoryObjectStore();
    const plugin = createPypiProxyPlugin({
      fetch: async (request) => {
        fetchedUrls.push(request.url);
        return new Response(upstreamHtml.get(request.url) ?? "", {
          status: upstreamHtml.has(request.url) ? 200 : 404,
          headers: { "content-type": "text/html" },
        });
      },
      objectStoreFor: () => objectStore,
    });
    const repository = {
      ...repositoryFixture(),
      kind: "proxy" as const,
      config: { pypi: { upstreamUrl: "https://pypi.org/" } },
    };

    const catalog = await plugin.artifacts?.rebuildIndex({
      repository,
      objectStore,
      now: new Date("2026-08-05T00:00:00.000Z"),
    });

    expect(catalog).toMatchObject({
      artifacts: expect.arrayContaining([
        expect.objectContaining({ identity: "pypi:proxy-project:alpha" }),
        expect.objectContaining({ identity: "pypi:proxy-project:charlie" }),
      ]),
      complete: false,
      continuation: { projectDetailOffset: 0 },
      progress: { current: 3, total: 6, message: "Project catalog indexed. Warming 3 project details" },
    });
    expect(fetchedUrls).toEqual(["https://pypi.org/simple/"]);

    const details = await plugin.artifacts?.rebuildIndex({
      repository,
      objectStore,
      now: new Date("2026-08-05T00:00:01.000Z"),
      continuation: { projectDetailOffset: 0 },
    });

    expect(details).toMatchObject({
      artifacts: expect.arrayContaining([
        expect.objectContaining({
          identity: "pypi:proxy-file:alpha:alpha-1.0-py3-none-any.whl",
          version: "1.0",
        }),
      ]),
      complete: false,
      continuation: { projectDetailOffset: 1 },
      progress: { current: 4, total: 6, message: "Warmed project details 1 of 3" },
    });
    expect(fetchedUrls).toEqual([
      "https://pypi.org/simple/",
      "https://pypi.org/simple/alpha/",
    ]);

    const remainingDetails = await plugin.artifacts?.rebuildIndex({
      repository,
      objectStore,
      now: new Date("2026-08-05T00:00:02.000Z"),
      continuation: { projectDetailOffset: 1 },
    });

    expect(remainingDetails).toMatchObject({
      artifacts: expect.arrayContaining([
        expect.objectContaining({
          identity: "pypi:proxy-file:bravo:bravo-1.0-py3-none-any.whl",
          version: "1.0",
        }),
      ]),
      complete: false,
      continuation: { projectDetailOffset: 2 },
      progress: { current: 5, total: 6, message: "Warmed project details 2 of 3" },
    });

    const lastDetails = await plugin.artifacts?.rebuildIndex({
      repository,
      objectStore,
      now: new Date("2026-08-05T00:00:03.000Z"),
      continuation: { projectDetailOffset: 2 },
    });

    expect(lastDetails).toMatchObject({
      artifacts: expect.arrayContaining([
        expect.objectContaining({
          identity: "pypi:proxy-file:charlie:charlie-1.0-py3-none-any.whl",
          version: "1.0",
        }),
      ]),
      complete: true,
      progress: { current: 6, total: 6, message: "Warmed project details 3 of 3" },
    });
    expect(fetchedUrls).toEqual([
      "https://pypi.org/simple/",
      "https://pypi.org/simple/alpha/",
      "https://pypi.org/simple/bravo/",
      "https://pypi.org/simple/charlie/",
    ]);
    await expect(objectStore.getObject("repositories/python-internal/_proxy-cache/pypi/projects/alpha.json"))
      .resolves.not.toBeNull();
    await expect(objectStore.getObject("repositories/python-internal/_proxy-cache/pypi/rebuild.json"))
      .resolves.toBeNull();
  });

  it("removes proxy project detail cache when a refreshed catalog no longer lists the project", async () => {
    const objectStore = new MemoryRepositoryObjectStore();
    await objectStore.putJson("repositories/python-internal/_proxy-cache/pypi/projects/removed.json", {
      name: "removed",
      files: [],
    });
    const plugin = createPypiProxyPlugin({
      fetch: async (request) => new Response(
        request.url === "https://pypi.org/simple/" ? "<a href=\"demo/\">demo</a>" : "",
        { status: request.url === "https://pypi.org/simple/" ? 200 : 404 },
      ),
      objectStoreFor: () => objectStore,
    });

    await plugin.artifacts?.rebuildIndex({
      repository: {
        ...repositoryFixture(),
        kind: "proxy",
        config: { pypi: { upstreamUrl: "https://pypi.org/" } },
      },
      objectStore,
      now: new Date("2026-08-05T00:00:00.000Z"),
    });

    await expect(objectStore.getObject("repositories/python-internal/_proxy-cache/pypi/projects/removed.json"))
      .resolves.toBeNull();
  });

  it("paginates proxy cached projects", async () => {
    const objectStore = new MemoryRepositoryObjectStore();
    await objectStore.putJson("repositories/python-internal/_proxy-cache/pypi/projects.json", {
      projects: [
        { name: "alpha" },
        { name: "bravo" },
        { name: "charlie" },
      ],
    });
    await objectStore.putJson("repositories/python-internal/_proxy-cache/pypi/projects/alpha.json", { name: "alpha", files: [] });
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
        },
      ],
    });
    await objectStore.putJson("repositories/python-internal/_proxy-cache/pypi/projects/demo.json", {
      name: "demo",
      files: [{
        filename: "demo-1.0-py3-none-any.whl",
        url: "https://files.example/demo-1.0-py3-none-any.whl",
      }],
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

  it("paginates PyPI proxy project directories from the virtual object browser", async () => {
    const objectStore = new MemoryRepositoryObjectStore();
    await objectStore.putJson("repositories/python-internal/_proxy-cache/pypi/projects.json", {
      upstreamUrl: "https://pypi.org/",
      refreshedAt: "2026-08-05T00:00:00.000Z",
      projects: [
        { name: "alpha" },
        { name: "bravo" },
        { name: "charlie" },
      ],
    });
    const plugin = createPypiProxyPlugin({ objectStoreFor: () => objectStore });
    const repository = {
      ...repositoryFixture(),
      kind: "proxy" as const,
      config: { pypi: { upstreamUrl: "https://pypi.org/" } },
    };

    const first = await plugin.objectBrowser?.listObjects({ repository, objectStore, prefix: "simple/", limit: 2 });

    expect(first).toMatchObject({
      prefix: "simple/",
      directories: [
        { name: "alpha", path: "simple/alpha/" },
        { name: "bravo", path: "simple/bravo/" },
      ],
      objects: [],
      truncated: true,
    });
    expect(first?.cursor).toEqual(expect.any(String));
    const cursor = first?.cursor;
    if (!cursor) {
      throw new Error("Expected a cursor for the second PyPI proxy browser page");
    }

    await expect(plugin.objectBrowser?.listObjects({
      repository,
      objectStore,
      prefix: "simple/",
      limit: 2,
      cursor,
    })).resolves.toMatchObject({
      prefix: "simple/",
      directories: [
        { name: "charlie", path: "simple/charlie/" },
      ],
      objects: [],
      truncated: false,
    });
  });

  it("does not fetch upstream while browsing uncached PyPI proxy project directories", async () => {
    const objectStore = new MemoryRepositoryObjectStore();
    await objectStore.putJson("repositories/python-internal/_proxy-cache/pypi/projects.json", {
      upstreamUrl: "https://pypi.org/",
      refreshedAt: "2026-08-05T00:00:00.000Z",
      projects: [{ name: "demo" }],
    });
    let fetchCount = 0;
    const plugin = createPypiProxyPlugin({
      objectStoreFor: () => objectStore,
      fetch: async () => {
        fetchCount += 1;
        return new Response("<a href=\"demo-1.0-py3-none-any.whl\">demo</a>");
      },
    });
    const repository = {
      ...repositoryFixture(),
      kind: "proxy" as const,
      config: { pypi: { upstreamUrl: "https://pypi.org/" } },
    };

    await expect(plugin.objectBrowser?.listObjects({
      repository,
      objectStore,
      prefix: "simple/demo/",
    })).resolves.toEqual({
      prefix: "simple/demo/",
      directories: [],
      objects: [],
      truncated: false,
    });
    expect(fetchCount).toBe(0);
  });

  it("keeps PyPI proxy object browser reads free of artifact index side effects", async () => {
    const objectStore = new MemoryRepositoryObjectStore();
    await objectStore.putJson("repositories/python-internal/_proxy-cache/pypi/projects.json", {
      upstreamUrl: "https://pypi.org/",
      refreshedAt: "2026-08-05T00:00:00.000Z",
      projects: [{ name: "demo" }],
    });
    await objectStore.putJson("repositories/python-internal/_proxy-cache/pypi/projects/demo.json", {
      name: "demo",
      files: [{
        filename: "demo-1.0-py3-none-any.whl",
        url: "https://files.example/demo-1.0-py3-none-any.whl",
      }],
    });
    const artifactStore = {
      upsert: vi.fn(async () => {}),
    } as unknown as RepositoryArtifactStore & { upsert: ReturnType<typeof vi.fn> };
    const plugin = createPypiProxyPlugin({ objectStoreFor: () => objectStore });
    const repository = {
      ...repositoryFixture(),
      kind: "proxy" as const,
      config: { pypi: { upstreamUrl: "https://pypi.org/" } },
    };

    await expect(plugin.objectBrowser?.listObjects({
      repository,
      objectStore,
      repositoryArtifactStore: artifactStore,
      prefix: "simple/demo/",
    })).resolves.toMatchObject({
      prefix: "simple/demo/",
      objects: [{ name: "demo-1.0-py3-none-any.whl" }],
    });
    await expect(plugin.objectBrowser?.getObjectDetail?.({
      repository,
      objectStore,
      repositoryArtifactStore: artifactStore,
      path: "simple/demo/demo-1.0-py3-none-any.whl",
      origin: "https://axis.example",
    })).resolves.toMatchObject({
      name: "demo-1.0-py3-none-any.whl",
    });

    expect(artifactStore.upsert).not.toHaveBeenCalled();
    const manifest = await objectStore.getObject("repositories/python-internal/_proxy-cache/pypi/projects.json");
    expect(JSON.parse(new TextDecoder().decode(await objectBytes(manifest!)))).toMatchObject({
      projects: [{ name: "demo" }],
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

  it("does not fetch proxy project pages during catalog refresh when project pages fail", async () => {
    const fetchedUrls: string[] = [];
    const plugin = createPypiProxyPlugin({
      fetch: async (request) => {
        fetchedUrls.push(request.url);
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

    await expect(plugin.artifacts?.rebuildIndex({
      repository: {
        ...repositoryFixture(),
        kind: "proxy",
        config: { pypi: { upstreamUrl: "https://pypi.org/" } },
      },
      objectStore: new MemoryRepositoryObjectStore(),
      now: new Date("2026-08-05T00:00:00.000Z"),
    })).resolves.toMatchObject({
      artifacts: [
        expect.objectContaining({ identity: "pypi:proxy-project:broken" }),
        expect.objectContaining({ identity: "pypi:proxy-project:demo" }),
      ],
      complete: false,
      continuation: { projectDetailOffset: 0 },
    });
    expect(fetchedUrls).toEqual(["https://pypi.org/simple/"]);
  });
});
