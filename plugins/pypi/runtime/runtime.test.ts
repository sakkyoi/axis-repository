import { describe, expect, it, vi } from "vitest";
import type { RepositoryArtifactRecord, RepositoryArtifactStore } from "@axis-repository/core";
import { dispatchRepositoryAdminResource, dispatchRepositoryClientHelper, objectBytes } from "@axis-repository/runtime-cloudflare/plugin-runtime";
import { MemoryRepositoryObjectStore } from "@axis-repository/runtime-cloudflare/plugin-runtime/testing";
import { createPypiGroupPlugin, createPypiPlugin, createPypiProxyPlugin, pypiProxyRetryDelayMs, pypiProxyUpstreamUrl } from "./runtime";

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

function repositoryArtifact(input: Partial<RepositoryArtifactRecord> & {
  id: string;
  repositoryName: string;
  identity: string;
  name: string;
  metadata: Record<string, unknown>;
}): RepositoryArtifactRecord {
  return {
    ecosystem: "pypi",
    version: "1.0",
    summary: input.name,
    primaryObjectKey: `repositories/${input.repositoryName}/packages/${input.name}/${input.id}.whl`,
    objectKeys: [`repositories/${input.repositoryName}/packages/${input.name}/${input.id}.whl`],
    publishedAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
    ...input,
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

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
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
    expect(pypiProxyUpstreamUrl("https://pypi.example/root/", "base-url", "simple/"))
      .toBe("https://pypi.example/root/simple/");
    expect(pypiProxyUpstreamUrl("https://pypi.example/root/", "base-url", "simple/demo/"))
      .toBe("https://pypi.example/root/simple/demo/");
    expect(pypiProxyUpstreamUrl("https://pypi.nvidia.com/", "simple-api-root", "simple/"))
      .toBe("https://pypi.nvidia.com/");
    expect(pypiProxyUpstreamUrl("https://pypi.nvidia.com/", "simple-api-root", "simple/demo/"))
      .toBe("https://pypi.nvidia.com/demo/");
    expect(pypiProxyUpstreamUrl("https://pypi.nvidia.com/", "base-url", "simple/demo/"))
      .toBe("https://pypi.nvidia.com/simple/demo/");
    expect(pypiProxyUpstreamUrl("https://pypi.org/", "base-url", "simple/"))
      .toBe("https://pypi.org/simple/");
    expect(pypiProxyUpstreamUrl("https://pypi.org/simple/", "simple-api-root", "simple/demo/"))
      .toBe("https://pypi.org/simple/demo/");
    expect(pypiProxyUpstreamUrl("https://pypi.example/root/", "base-url", "packages/demo/demo-1.0.whl"))
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
        config: { pypi: { upstreamUrl: "https://pypi.example/root/", upstreamUrlMode: "base-url" } },
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

  it("accepts PyPI proxy config whose upstream probes as a Simple API root", async () => {
    const requests: Request[] = [];
    const plugin = createPypiProxyPlugin({
      fetch: async (request) => {
        requests.push(request);
        return new Response("<a href=\"demo/\">demo</a>", {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      },
    });

    await expect(plugin.validateRepositoryConfig({
      ecosystem: "pypi",
      config: { pypi: { upstreamUrl: "https://pypi.example/", upstreamUrlMode: "base-url" } },
    })).resolves.toBeUndefined();
    expect(requests.map((request) => request.url)).toEqual(["https://pypi.example/simple/"]);
  });

  it("rejects PyPI proxy config whose upstream probes as a Simple project HTML page", async () => {
    const plugin = createPypiProxyPlugin({
      fetch: async () => new Response([
        "<html><body>",
        "<h1>Links for peppercorn</h1>",
        `<a href="peppercorn-0.6-py3-none-any.whl#sha256=${"a".repeat(64)}">peppercorn-0.6-py3-none-any.whl</a>`,
        "</body></html>",
      ].join(""), {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    });

    await expect(plugin.validateRepositoryConfig({
      ecosystem: "pypi",
      config: { pypi: { upstreamUrl: "https://pypi.example/simple/peppercorn/", upstreamUrlMode: "simple-api-root" } },
    })).rejects.toThrow("config.pypi.upstreamUrl points to a Simple API project page; use the Simple API root instead");
  });

  it("rejects PyPI proxy config when the upstream root cannot be probed", async () => {
    const plugin = createPypiProxyPlugin({
      fetch: async () => {
        throw new Error("network down");
      },
    });

    await expect(plugin.validateRepositoryConfig({
      ecosystem: "pypi",
      config: { pypi: { upstreamUrl: "https://pypi.example/", upstreamUrlMode: "base-url" } },
    })).rejects.toThrow("config.pypi.upstreamUrl could not be verified as a PyPI Simple API root: network down");
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
        config: { pypi: { upstreamUrl: "https://pypi.example/root/", upstreamUrlMode: "base-url" } },
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

  it("caches full PyPI proxy file GET responses in object storage", async () => {
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
          headers: {
            "content-type": "application/octet-stream",
            etag: "\"cached-etag\"",
            "last-modified": "Wed, 05 Aug 2026 10:00:00 GMT",
            "content-length": "11",
          },
        });
      },
    });
    const repository = {
      ...repositoryFixture(),
      kind: "proxy" as const,
      config: { pypi: { upstreamUrl: "https://pypi.example/root/", upstreamUrlMode: "base-url" } },
    };

    const first = await plugin.serveRepositoryPath?.({
      repository,
      request: new Request("https://axis.example/repositories/python-internal/simple/demo/demo-1.0-py3-none-any.whl"),
      relativePath: "simple/demo/demo-1.0-py3-none-any.whl",
    });
    const second = await plugin.serveRepositoryPath?.({
      repository,
      request: new Request("https://axis.example/repositories/python-internal/simple/demo/demo-1.0-py3-none-any.whl"),
      relativePath: "simple/demo/demo-1.0-py3-none-any.whl",
    });

    expect(upstreamRequests).toHaveLength(1);
    expect(first?.headers.get("etag")).toBe("\"cached-etag\"");
    expect(second?.headers.get("etag")).toBe("\"cached-etag\"");
    expect(second?.headers.get("last-modified")).toBe("Wed, 05 Aug 2026 10:00:00 GMT");
    expect(second?.headers.get("content-length")).toBe("11");
    await expect(first?.text()).resolves.toBe("wheel bytes");
    await expect(second?.text()).resolves.toBe("wheel bytes");
  });

  it("streams first PyPI proxy file downloads while caching in a background task", async () => {
    const objectStore = new MemoryRepositoryObjectStore();
    await objectStore.putJson("repositories/python-internal/_proxy-cache/pypi/projects/demo.json", {
      name: "demo",
      files: [{
        filename: "demo-1.0-py3-none-any.whl",
        url: "https://files.example/packages/demo-1.0-py3-none-any.whl",
      }],
    });
    const writes = deferred<void>();
    objectStore.createPartWriter = async (key, contentType) => {
      const writer = await MemoryRepositoryObjectStore.prototype.createPartWriter.call(objectStore, key, contentType);
      return {
        ...writer,
        write: async (chunk) => {
          await writes.promise;
          await writer.write(chunk);
        },
      };
    };
    const backgroundTasks: Promise<unknown>[] = [];
    const plugin = createPypiProxyPlugin({
      objectStoreFor: () => objectStore,
      fetch: async () => new Response("wheel bytes", {
        headers: {
          "content-type": "application/octet-stream",
          "content-length": "11",
          etag: "\"cached-etag\"",
        },
      }),
    });

    const served = plugin.serveRepositoryPath?.({
      repository: {
        ...repositoryFixture(),
        kind: "proxy",
        config: { pypi: { upstreamUrl: "https://pypi.example/root/", upstreamUrlMode: "base-url" } },
      },
      request: new Request("https://axis.example/repositories/python-internal/simple/demo/demo-1.0-py3-none-any.whl"),
      relativePath: "simple/demo/demo-1.0-py3-none-any.whl",
      backgroundTasks: {
        waitUntil: (task) => {
          backgroundTasks.push(task);
        },
      },
    });

    const response = await Promise.race([
      served,
      new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 20)),
    ]);

    expect(response).not.toBe("pending");
    expect(backgroundTasks).toHaveLength(1);
    expect((response as Response | null)?.headers.get("etag")).toBe("\"cached-etag\"");
    await expect((response as Response | null)?.text()).resolves.toBe("wheel bytes");
    writes.resolve();
    await expect(backgroundTasks[0]).resolves.toBeUndefined();
    await expect(objectStore.listObjects({
      prefix: "repositories/python-internal/_proxy-cache/pypi/files/",
    })).resolves.toMatchObject({ objects: expect.arrayContaining([expect.objectContaining({
      key: expect.not.stringMatching(/\.json$/),
    })]) });
  });

  it("waits for an in-flight PyPI proxy file cache write instead of fetching the same file twice", async () => {
    const objectStore = new MemoryRepositoryObjectStore();
    await objectStore.putJson("repositories/python-internal/_proxy-cache/pypi/projects/demo.json", {
      name: "demo",
      files: [{
        filename: "demo-1.0-py3-none-any.whl",
        url: "https://files.example/packages/demo-1.0-py3-none-any.whl",
      }],
    });
    const writes = deferred<void>();
    objectStore.createPartWriter = async (key, contentType) => {
      const writer = await MemoryRepositoryObjectStore.prototype.createPartWriter.call(objectStore, key, contentType);
      return {
        ...writer,
        write: async (chunk) => {
          await writes.promise;
          await writer.write(chunk);
        },
      };
    };
    const backgroundTasks: Promise<unknown>[] = [];
    const upstreamRequests: Request[] = [];
    const plugin = createPypiProxyPlugin({
      objectStoreFor: () => objectStore,
      fetch: async (request) => {
        upstreamRequests.push(request);
        return new Response("wheel bytes", {
          headers: {
            "content-type": "application/octet-stream",
            "content-length": "11",
          },
        });
      },
    });
    const repository = {
      ...repositoryFixture(),
      kind: "proxy" as const,
      config: { pypi: { upstreamUrl: "https://pypi.example/root/", upstreamUrlMode: "base-url" } },
    };

    const first = plugin.serveRepositoryPath?.({
      repository,
      request: new Request("https://axis.example/repositories/python-internal/simple/demo/demo-1.0-py3-none-any.whl"),
      relativePath: "simple/demo/demo-1.0-py3-none-any.whl",
      backgroundTasks: { waitUntil: (task) => backgroundTasks.push(task) },
    });
    const firstBeforeCacheCompletes = await Promise.race([
      first,
      new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 20)),
    ]);
    if (firstBeforeCacheCompletes === "pending") {
      throw new Error("first proxy response waited for the cache writer");
    }
    const second = plugin.serveRepositoryPath?.({
      repository,
      request: new Request("https://axis.example/repositories/python-internal/simple/demo/demo-1.0-py3-none-any.whl"),
      relativePath: "simple/demo/demo-1.0-py3-none-any.whl",
      backgroundTasks: { waitUntil: (task) => backgroundTasks.push(task) },
    });
    const secondBeforeCacheCompletes = await Promise.race([
      second,
      new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 20)),
    ]);

    expect(firstBeforeCacheCompletes?.status).toBe(200);
    expect(secondBeforeCacheCompletes).toBe("pending");
    expect(upstreamRequests).toHaveLength(1);
    writes.resolve();
    await expect(backgroundTasks[0]).resolves.toBeUndefined();
    const secondResponse = await second;
    expect(upstreamRequests).toHaveLength(1);
    await expect(secondResponse?.text()).resolves.toBe("wheel bytes");
  });

  it("serves cached PyPI proxy file metadata for HEAD requests", async () => {
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
          headers: {
            "content-type": "application/octet-stream",
            "content-length": "11",
            etag: "\"cached-etag\"",
            "last-modified": "Wed, 05 Aug 2026 10:00:00 GMT",
          },
        });
      },
    });
    const repository = {
      ...repositoryFixture(),
      kind: "proxy" as const,
      config: { pypi: { upstreamUrl: "https://pypi.example/root/", upstreamUrlMode: "base-url" } },
    };

    await plugin.serveRepositoryPath?.({
      repository,
      request: new Request("https://axis.example/repositories/python-internal/simple/demo/demo-1.0-py3-none-any.whl"),
      relativePath: "simple/demo/demo-1.0-py3-none-any.whl",
    });
    const head = await plugin.serveRepositoryPath?.({
      repository,
      request: new Request("https://axis.example/repositories/python-internal/simple/demo/demo-1.0-py3-none-any.whl", {
        method: "HEAD",
      }),
      relativePath: "simple/demo/demo-1.0-py3-none-any.whl",
    });

    expect(upstreamRequests).toHaveLength(1);
    expect(head?.status).toBe(200);
    expect(head?.headers.get("content-type")).toBe("application/octet-stream");
    expect(head?.headers.get("content-length")).toBe("11");
    expect(head?.headers.get("etag")).toBe("\"cached-etag\"");
    expect(head?.headers.get("last-modified")).toBe("Wed, 05 Aug 2026 10:00:00 GMT");
    await expect(head?.text()).resolves.toBe("");
  });

  it("preserves cache-control on cached PyPI proxy file responses", async () => {
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
          headers: {
            "content-type": "application/octet-stream",
            "content-length": "11",
            "cache-control": "public, max-age=31536000, immutable",
          },
        });
      },
    });
    const repository = {
      ...repositoryFixture(),
      kind: "proxy" as const,
      config: { pypi: { upstreamUrl: "https://pypi.example/root/", upstreamUrlMode: "base-url" } },
    };

    await plugin.serveRepositoryPath?.({
      repository,
      request: new Request("https://axis.example/repositories/python-internal/simple/demo/demo-1.0-py3-none-any.whl"),
      relativePath: "simple/demo/demo-1.0-py3-none-any.whl",
    });
    const cached = await plugin.serveRepositoryPath?.({
      repository,
      request: new Request("https://axis.example/repositories/python-internal/simple/demo/demo-1.0-py3-none-any.whl"),
      relativePath: "simple/demo/demo-1.0-py3-none-any.whl",
    });

    expect(upstreamRequests).toHaveLength(1);
    expect(cached?.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    await expect(cached?.text()).resolves.toBe("wheel bytes");
  });

  it("does not cache PyPI proxy file responses that disallow storage", async () => {
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
          headers: {
            "content-type": "application/octet-stream",
            "content-length": "11",
            "cache-control": upstreamRequests.length === 1 ? "private, no-store" : "private",
          },
        });
      },
    });
    const repository = {
      ...repositoryFixture(),
      kind: "proxy" as const,
      config: { pypi: { upstreamUrl: "https://pypi.example/root/", upstreamUrlMode: "base-url" } },
    };

    const first = await plugin.serveRepositoryPath?.({
      repository,
      request: new Request("https://axis.example/repositories/python-internal/simple/demo/demo-1.0-py3-none-any.whl"),
      relativePath: "simple/demo/demo-1.0-py3-none-any.whl",
    });
    const second = await plugin.serveRepositoryPath?.({
      repository,
      request: new Request("https://axis.example/repositories/python-internal/simple/demo/demo-1.0-py3-none-any.whl"),
      relativePath: "simple/demo/demo-1.0-py3-none-any.whl",
    });

    expect(upstreamRequests).toHaveLength(2);
    expect(first?.headers.get("cache-control")).toBe("private, no-store");
    expect(second?.headers.get("cache-control")).toBe("private");
    await expect(objectStore.listObjects({
      prefix: "repositories/python-internal/_proxy-cache/pypi/files/",
    })).resolves.toMatchObject({ objects: [] });
  });

  it("does not cache PyPI proxy file responses larger than the byte cache limit", async () => {
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
          headers: {
            "content-type": "application/octet-stream",
            "content-length": String(512 * 1024 * 1024 + 1),
          },
        });
      },
    });
    const repository = {
      ...repositoryFixture(),
      kind: "proxy" as const,
      config: { pypi: { upstreamUrl: "https://pypi.example/root/", upstreamUrlMode: "base-url" } },
    };

    await plugin.serveRepositoryPath?.({
      repository,
      request: new Request("https://axis.example/repositories/python-internal/simple/demo/demo-1.0-py3-none-any.whl"),
      relativePath: "simple/demo/demo-1.0-py3-none-any.whl",
    });
    await plugin.serveRepositoryPath?.({
      repository,
      request: new Request("https://axis.example/repositories/python-internal/simple/demo/demo-1.0-py3-none-any.whl"),
      relativePath: "simple/demo/demo-1.0-py3-none-any.whl",
    });

    expect(upstreamRequests).toHaveLength(2);
    await expect(objectStore.listObjects({
      prefix: "repositories/python-internal/_proxy-cache/pypi/files/",
    })).resolves.toMatchObject({ objects: [] });
  });

  it("uses repository proxy policy when deciding whether to cache PyPI proxy file bytes", async () => {
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
          headers: {
            "content-type": "application/octet-stream",
            "content-length": String(512 * 1024 * 1024 + 1),
            "cache-control": "private, no-store",
          },
        });
      },
    });
    const repository = {
      ...repositoryFixture(),
      kind: "proxy" as const,
      config: {
        pypi: {
          upstreamUrl: "https://pypi.example/root/",
          upstreamUrlMode: "base-url",
          proxyPolicy: {
            fileByteCache: {
              maxBytes: 512 * 1024 * 1024 + 1,
              respectUpstreamCacheControl: false,
            },
          },
        },
      },
    };

    await plugin.serveRepositoryPath?.({
      repository,
      request: new Request("https://axis.example/repositories/python-internal/simple/demo/demo-1.0-py3-none-any.whl"),
      relativePath: "simple/demo/demo-1.0-py3-none-any.whl",
    });
    const cached = await plugin.serveRepositoryPath?.({
      repository,
      request: new Request("https://axis.example/repositories/python-internal/simple/demo/demo-1.0-py3-none-any.whl"),
      relativePath: "simple/demo/demo-1.0-py3-none-any.whl",
    });

    expect(upstreamRequests).toHaveLength(1);
    await expect(cached?.text()).resolves.toBe("wheel bytes");
  });

  it("treats expired PyPI proxy file byte cache entries as misses", async () => {
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
        return new Response(`wheel bytes ${upstreamRequests.length}`, {
          headers: {
            "content-type": "application/octet-stream",
            "content-length": "13",
          },
        });
      },
    });
    const repository = {
      ...repositoryFixture(),
      kind: "proxy" as const,
      config: {
        pypi: {
          upstreamUrl: "https://pypi.example/root/",
          upstreamUrlMode: "base-url",
          proxyPolicy: { fileByteCache: { ttlSeconds: 1 } },
        },
      },
    };

    await plugin.serveRepositoryPath?.({
      repository,
      request: new Request("https://axis.example/repositories/python-internal/simple/demo/demo-1.0-py3-none-any.whl"),
      relativePath: "simple/demo/demo-1.0-py3-none-any.whl",
    });
    const metadata = objectStore.objects.find((object) => object.key.endsWith(".json") && object.key.includes("_proxy-cache/pypi/files/"));
    if (metadata && typeof metadata.value === "object" && metadata.value) {
      (metadata.value as { cachedAt: string }).cachedAt = "2026-08-05T00:00:00.000Z";
    }
    const second = await plugin.serveRepositoryPath?.({
      repository,
      request: new Request("https://axis.example/repositories/python-internal/simple/demo/demo-1.0-py3-none-any.whl"),
      relativePath: "simple/demo/demo-1.0-py3-none-any.whl",
    });

    expect(upstreamRequests).toHaveLength(2);
    await expect(second?.text()).resolves.toBe("wheel bytes 2");
  });

  it("evicts old PyPI proxy file byte cache entries over the total byte budget", async () => {
    const objectStore = new MemoryRepositoryObjectStore();
    await objectStore.putJson("repositories/python-internal/_proxy-cache/pypi/projects/alpha.json", {
      name: "alpha",
      files: [{ filename: "alpha-1.0-py3-none-any.whl", url: "https://files.example/alpha.whl" }],
    });
    await objectStore.putJson("repositories/python-internal/_proxy-cache/pypi/projects/bravo.json", {
      name: "bravo",
      files: [{ filename: "bravo-1.0-py3-none-any.whl", url: "https://files.example/bravo.whl" }],
    });
    const plugin = createPypiProxyPlugin({
      objectStoreFor: () => objectStore,
      fetch: async (request) => new Response(request.url.includes("alpha") ? "alpha bytes" : "bravo bytes", {
        headers: {
          "content-type": "application/octet-stream",
          "content-length": "11",
        },
      }),
    });
    const repository = {
      ...repositoryFixture(),
      kind: "proxy" as const,
      config: {
        pypi: {
          upstreamUrl: "https://pypi.example/root/",
          upstreamUrlMode: "base-url",
          proxyPolicy: { fileByteCache: { maxTotalBytes: 11 } },
        },
      },
    };

    await plugin.serveRepositoryPath?.({
      repository,
      request: new Request("https://axis.example/repositories/python-internal/simple/alpha/alpha-1.0-py3-none-any.whl"),
      relativePath: "simple/alpha/alpha-1.0-py3-none-any.whl",
    });
    await plugin.serveRepositoryPath?.({
      repository,
      request: new Request("https://axis.example/repositories/python-internal/simple/bravo/bravo-1.0-py3-none-any.whl"),
      relativePath: "simple/bravo/bravo-1.0-py3-none-any.whl",
    });

    const cacheObjects = await objectStore.listObjects({ prefix: "repositories/python-internal/_proxy-cache/pypi/files/" });
    expect(cacheObjects.objects.filter((object) => !object.key.endsWith(".json"))).toHaveLength(1);
  });

  it("bypasses the PyPI proxy file byte cache for conditional requests", async () => {
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
        if (request.headers.has("if-none-match")) {
          return new Response(null, {
            status: 304,
            headers: {
              etag: "\"cached-etag\"",
              "cache-control": "public, max-age=31536000, immutable",
            },
          });
        }
        return new Response("wheel bytes", {
          headers: {
            "content-type": "application/octet-stream",
            "content-length": "11",
            etag: "\"cached-etag\"",
            "cache-control": "public, max-age=31536000, immutable",
          },
        });
      },
    });
    const repository = {
      ...repositoryFixture(),
      kind: "proxy" as const,
      config: { pypi: { upstreamUrl: "https://pypi.example/root/", upstreamUrlMode: "base-url" } },
    };

    await plugin.serveRepositoryPath?.({
      repository,
      request: new Request("https://axis.example/repositories/python-internal/simple/demo/demo-1.0-py3-none-any.whl"),
      relativePath: "simple/demo/demo-1.0-py3-none-any.whl",
    });
    const conditional = await plugin.serveRepositoryPath?.({
      repository,
      request: new Request("https://axis.example/repositories/python-internal/simple/demo/demo-1.0-py3-none-any.whl", {
        headers: { "if-none-match": "\"cached-etag\"" },
      }),
      relativePath: "simple/demo/demo-1.0-py3-none-any.whl",
    });

    expect(upstreamRequests).toHaveLength(2);
    expect(upstreamRequests[1]?.headers.get("if-none-match")).toBe("\"cached-etag\"");
    expect(conditional?.status).toBe(304);
    expect(conditional?.headers.get("etag")).toBe("\"cached-etag\"");
    expect(conditional?.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    await expect(conditional?.text()).resolves.toBe("");
  });

  it("keeps PyPI proxy range requests on the upstream path even when a full file is cached", async () => {
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
        if (request.headers.has("range")) {
          return new Response("partial", {
            status: 206,
            headers: {
              "content-range": "bytes 0-6/11",
              "content-length": "7",
            },
          });
        }
        return new Response("wheel bytes", {
          headers: { "content-type": "application/octet-stream", "content-length": "11" },
        });
      },
    });
    const repository = {
      ...repositoryFixture(),
      kind: "proxy" as const,
      config: { pypi: { upstreamUrl: "https://pypi.example/root/", upstreamUrlMode: "base-url" } },
    };

    await plugin.serveRepositoryPath?.({
      repository,
      request: new Request("https://axis.example/repositories/python-internal/simple/demo/demo-1.0-py3-none-any.whl"),
      relativePath: "simple/demo/demo-1.0-py3-none-any.whl",
    });
    const ranged = await plugin.serveRepositoryPath?.({
      repository,
      request: new Request("https://axis.example/repositories/python-internal/simple/demo/demo-1.0-py3-none-any.whl", {
        headers: { range: "bytes=0-6" },
      }),
      relativePath: "simple/demo/demo-1.0-py3-none-any.whl",
    });

    expect(upstreamRequests).toHaveLength(2);
    expect(upstreamRequests[1]?.headers.get("range")).toBe("bytes=0-6");
    expect(ranged?.status).toBe(206);
    await expect(ranged?.text()).resolves.toBe("partial");
  });

  it("forwards range and conditional headers when proxying cached PyPI files", async () => {
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
        return new Response("partial bytes", {
          status: 206,
          headers: {
            "content-type": "application/octet-stream",
            "content-length": "13",
            "content-range": "bytes 10-22/100",
            "accept-ranges": "bytes",
            etag: "\"abc\"",
            "last-modified": "Wed, 05 Aug 2026 10:00:00 GMT",
            connection: "keep-alive",
            "transfer-encoding": "chunked",
          },
        });
      },
    });

    const response = await plugin.serveRepositoryPath?.({
      repository: {
        ...repositoryFixture(),
        kind: "proxy",
        config: { pypi: { upstreamUrl: "https://pypi.example/root/", upstreamUrlMode: "base-url" } },
      },
      request: new Request("https://axis.example/repositories/python-internal/simple/demo/demo-1.0-py3-none-any.whl", {
        headers: {
          range: "bytes=10-22",
          "if-range": "\"abc\"",
          "if-none-match": "\"old\"",
          "if-modified-since": "Wed, 05 Aug 2026 09:00:00 GMT",
        },
      }),
      relativePath: "simple/demo/demo-1.0-py3-none-any.whl",
    });

    expect(upstreamRequests[0]?.headers.get("range")).toBe("bytes=10-22");
    expect(upstreamRequests[0]?.headers.get("if-range")).toBe("\"abc\"");
    expect(upstreamRequests[0]?.headers.get("if-none-match")).toBe("\"old\"");
    expect(upstreamRequests[0]?.headers.get("if-modified-since")).toBe("Wed, 05 Aug 2026 09:00:00 GMT");
    expect(response?.status).toBe(206);
    expect(response?.headers.get("content-range")).toBe("bytes 10-22/100");
    expect(response?.headers.get("accept-ranges")).toBe("bytes");
    expect(response?.headers.get("etag")).toBe("\"abc\"");
    expect(response?.headers.get("last-modified")).toBe("Wed, 05 Aug 2026 10:00:00 GMT");
    expect(response?.headers.get("connection")).toBeNull();
    expect(response?.headers.get("transfer-encoding")).toBeNull();
    await expect(response?.text()).resolves.toBe("partial bytes");
  });

  it("proxies HEAD requests for cached PyPI files without a response body", async () => {
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
        return new Response("must not be returned", {
          headers: {
            "content-type": "application/octet-stream",
            "content-length": "123",
            "accept-ranges": "bytes",
          },
        });
      },
    });

    const response = await plugin.serveRepositoryPath?.({
      repository: {
        ...repositoryFixture(),
        kind: "proxy",
        config: { pypi: { upstreamUrl: "https://pypi.example/root/", upstreamUrlMode: "base-url" } },
      },
      request: new Request("https://axis.example/repositories/python-internal/simple/demo/demo-1.0-py3-none-any.whl", {
        method: "HEAD",
      }),
      relativePath: "simple/demo/demo-1.0-py3-none-any.whl",
    });

    expect(upstreamRequests[0]?.method).toBe("HEAD");
    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-length")).toBe("123");
    expect(response?.headers.get("accept-ranges")).toBe("bytes");
    await expect(response?.text()).resolves.toBe("");
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
        config: { pypi: { upstreamUrl: "https://pypi.example/", upstreamUrlMode: "simple-api-root" } },
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
      config: { pypi: { upstreamUrl: "https://pypi.org/", upstreamUrlMode: "base-url" } },
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
          metadata: expect.objectContaining({
            source: "proxy",
            project: "demo",
            upstreamUrl: "https://pypi.org/simple/demo/",
            cacheStatus: "pending",
          }),
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
      config: { pypi: { upstreamUrl: "https://pypi.org/", upstreamUrlMode: "base-url" } },
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

  it("reports PyPI proxy byte cache stats without counting metadata objects", async () => {
    const objectStore = new MemoryRepositoryObjectStore();
    await objectStore.putBytes(
      "repositories/python-internal/_proxy-cache/pypi/files/file-a",
      new Uint8Array(11),
      "application/octet-stream",
    );
    await objectStore.putJson("repositories/python-internal/_proxy-cache/pypi/files/file-a.json", {
      upstreamUrl: "https://files.example/a.whl",
    });
    await objectStore.putBytes(
      "repositories/python-internal/_proxy-cache/pypi/files/file-b",
      new Uint8Array(7),
      "application/octet-stream",
    );
    await objectStore.putJson("repositories/python-internal/_proxy-cache/pypi/projects.json", {
      projects: [{ name: "demo", fileCount: 1 }],
      refreshedAt: "2026-08-05T00:00:00.000Z",
    });
    const plugin = createPypiProxyPlugin({ objectStoreFor: () => objectStore });
    const repository = {
      ...repositoryFixture(),
      kind: "proxy" as const,
      config: { pypi: { upstreamUrl: "https://pypi.org/", upstreamUrlMode: "base-url" } },
    };

    const response = await dispatchRepositoryAdminResource(plugin.adminResources!, {
      repositoryName: repository.name,
      repository,
      request: new Request("https://axis.example/admin/repositories/python-internal/pypi/proxy-cache"),
      path: ["proxy-cache"],
      services: { secrets: unusedSecrets() },
    });

    await expect(response.json()).resolves.toEqual({
      cache: {
        fileCount: 2,
        byteCount: 18,
        catalogProjectCount: 1,
        catalogRefreshedAt: "2026-08-05T00:00:00.000Z",
      },
    });
  });

  it("does not synchronously purge PyPI proxy byte cache objects from plugin resources", async () => {
    const objectStore = new MemoryRepositoryObjectStore();
    await objectStore.putBytes(
      "repositories/python-internal/_proxy-cache/pypi/files/file-a",
      new Uint8Array(11),
      "application/octet-stream",
    );
    await objectStore.putJson("repositories/python-internal/_proxy-cache/pypi/files/file-a.json", {
      upstreamUrl: "https://files.example/a.whl",
    });
    await objectStore.putJson("repositories/python-internal/_proxy-cache/pypi/projects.json", {
      projects: [{ name: "demo", fileCount: 1 }],
    });
    await objectStore.putJson("repositories/python-internal/_proxy-cache/pypi/projects/demo.json", {
      name: "demo",
      files: [],
    });
    const plugin = createPypiProxyPlugin({ objectStoreFor: () => objectStore });
    const repository = {
      ...repositoryFixture(),
      kind: "proxy" as const,
      config: { pypi: { upstreamUrl: "https://pypi.org/", upstreamUrlMode: "base-url" } },
    };

    await expect(dispatchRepositoryAdminResource(plugin.adminResources!, {
      repositoryName: repository.name,
      repository,
      request: new Request("https://axis.example/admin/repositories/python-internal/pypi/proxy-cache/purge", {
        method: "POST",
      }),
      path: ["proxy-cache", "purge"],
      services: { secrets: unusedSecrets() },
    })).rejects.toThrow("PyPI proxy byte cache purge must be queued by the runtime");
    await expect(objectStore.listObjects({
      prefix: "repositories/python-internal/_proxy-cache/pypi/files/",
    })).resolves.toMatchObject({ objects: expect.arrayContaining([
      expect.objectContaining({ key: "repositories/python-internal/_proxy-cache/pypi/files/file-a" }),
    ]) });
    await expect(objectStore.getObject("repositories/python-internal/_proxy-cache/pypi/projects.json")).resolves.not.toBeNull();
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
      config: { pypi: { upstreamUrl: "https://pypi.org/", upstreamUrlMode: "base-url" } },
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
      config: { pypi: { upstreamUrl: "https://pypi.org/", upstreamUrlMode: "base-url" } },
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

  it("warms proxy project details in bounded batches inside the repository index job", async () => {
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
      config: { pypi: { upstreamUrl: "https://pypi.org/", upstreamUrlMode: "base-url" } },
    };

    const catalog = await plugin.artifacts?.rebuildIndex({
      repository,
      objectStore,
      now: new Date("2026-08-05T00:00:00.000Z"),
    });

    expect(catalog).toMatchObject({
      artifacts: expect.arrayContaining([
        expect.objectContaining({
          identity: "pypi:proxy-project:alpha",
          metadata: expect.objectContaining({ cacheStatus: "pending" }),
        }),
        expect.objectContaining({
          identity: "pypi:proxy-project:charlie",
          metadata: expect.objectContaining({ cacheStatus: "pending" }),
        }),
      ]),
      complete: false,
      continuation: { projectDetailOffset: 0 },
      progress: { current: 3, total: 6, message: "Project catalog indexed. Warming 3 project details" },
      result: {
        proxyIndex: {
          phase: "warming-project-details",
          projectCount: 3,
          warmedProjectCount: 0,
          failedProjectCount: 0,
        },
      },
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
        expect.objectContaining({
          identity: "pypi:proxy-file:bravo:bravo-1.0-py3-none-any.whl",
          version: "1.0",
        }),
        expect.objectContaining({
          identity: "pypi:proxy-file:charlie:charlie-1.0-py3-none-any.whl",
          version: "1.0",
        }),
      ]),
      complete: true,
      progress: { current: 6, total: 6, message: "Warmed project details 3 of 3" },
      result: {
        proxyIndex: {
          phase: "complete",
          projectCount: 3,
          warmedProjectCount: 3,
          failedProjectCount: 0,
        },
      },
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

  it("completes proxy detail warming with partial failure samples instead of failing the whole catalog", async () => {
    const projectNames = ["alpha", "broken", "charlie"];
    const upstreamHtml = new Map<string, string>([
      ["https://pypi.org/simple/", projectNames.map((project) => `<a href="${project}/">${project}</a>`).join("")],
      [
        "https://pypi.org/simple/alpha/",
        `<a href="alpha-1.0-py3-none-any.whl#sha256=${"a".repeat(64)}">alpha-1.0-py3-none-any.whl</a>`,
      ],
      [
        "https://pypi.org/simple/charlie/",
        `<a href="charlie-1.0-py3-none-any.whl#sha256=${"c".repeat(64)}">charlie-1.0-py3-none-any.whl</a>`,
      ],
    ]);
    const objectStore = new MemoryRepositoryObjectStore();
    const plugin = createPypiProxyPlugin({
      fetch: async (request) => new Response(upstreamHtml.get(request.url) ?? "unavailable", {
        status: upstreamHtml.has(request.url) ? 200 : 503,
        headers: { "content-type": "text/html" },
      }),
      objectStoreFor: () => objectStore,
    });
    const repository = {
      ...repositoryFixture(),
      kind: "proxy" as const,
      config: { pypi: { upstreamUrl: "https://pypi.org/", upstreamUrlMode: "base-url" } },
    };

    await plugin.artifacts?.rebuildIndex({
      repository,
      objectStore,
      now: new Date("2026-08-05T00:00:00.000Z"),
    });
    const details = await plugin.artifacts?.rebuildIndex({
      repository,
      objectStore,
      now: new Date("2026-08-05T00:00:01.000Z"),
      continuation: { projectDetailOffset: 0 },
    });

    expect(details).toMatchObject({
      artifacts: expect.arrayContaining([
        expect.objectContaining({
          identity: "pypi:proxy-project:broken",
          metadata: expect.objectContaining({
            cacheStatus: "failed",
            lastCacheFailure: "PyPI proxy upstream project broken returned 503",
          }),
        }),
        expect.objectContaining({
          identity: "pypi:proxy-file:alpha:alpha-1.0-py3-none-any.whl",
        }),
        expect.objectContaining({
          identity: "pypi:proxy-file:charlie:charlie-1.0-py3-none-any.whl",
        }),
      ]),
      complete: true,
      progress: {
        current: 6,
        total: 6,
        message: "Warmed project details 2 of 3; 1 failed",
      },
      result: {
        proxyIndex: {
          phase: "complete-with-failures",
          projectCount: 3,
          warmedProjectCount: 2,
          failedProjectCount: 1,
          failedProjects: [{
            project: "broken",
            message: "PyPI proxy upstream project broken returned 503",
            retryable: true,
          }],
        },
      },
    });
    await expect(objectStore.getObject("repositories/python-internal/_proxy-cache/pypi/projects/broken.json"))
      .resolves.toBeNull();
    await expect(objectStore.getObject("repositories/python-internal/_proxy-cache/pypi/rebuild.json"))
      .resolves.toBeNull();
  });

  it("classifies proxy project warming failures by upstream status", async () => {
    const projectNames = ["rate-limited", "missing"];
    const objectStore = new MemoryRepositoryObjectStore();
    const plugin = createPypiProxyPlugin({
      fetch: async (request) => {
        if (request.url === "https://pypi.org/simple/") {
          return new Response(projectNames.map((project) => `<a href="${project}/">${project}</a>`).join(""), {
            headers: { "content-type": "text/html" },
          });
        }
        return new Response("unavailable", {
          status: request.url.endsWith("/rate-limited/") ? 429 : 404,
          headers: { "content-type": "text/html" },
        });
      },
      objectStoreFor: () => objectStore,
    });
    const repository = {
      ...repositoryFixture(),
      kind: "proxy" as const,
      config: { pypi: { upstreamUrl: "https://pypi.org/", upstreamUrlMode: "base-url" } },
    };

    await plugin.artifacts?.rebuildIndex({
      repository,
      objectStore,
      now: new Date("2026-08-05T00:00:00.000Z"),
    });
    const details = await plugin.artifacts?.rebuildIndex({
      repository,
      objectStore,
      now: new Date("2026-08-05T00:00:01.000Z"),
      continuation: { projectDetailOffset: 0 },
    });

    expect(Array.isArray(details) ? undefined : details?.result?.proxyIndex).toMatchObject({
      failedProjectCount: 2,
      failedProjects: expect.arrayContaining([
        expect.objectContaining({ project: "rate-limited", status: 429, retryable: true }),
        expect.objectContaining({ project: "missing", status: 404, retryable: false }),
      ]),
    });
  });

  it("retries retryable proxy project upstream failures before recording a partial failure", async () => {
    const objectStore = new MemoryRepositoryObjectStore();
    let projectAttempts = 0;
    const plugin = createPypiProxyPlugin({
      fetch: async (request) => {
        if (request.url === "https://pypi.org/simple/") {
          return new Response("<a href=\"flaky/\">flaky</a>", {
            headers: { "content-type": "text/html" },
          });
        }
        projectAttempts += 1;
        return new Response(projectAttempts === 1 ? "temporarily unavailable" : "<a href=\"flaky-1.0-py3-none-any.whl\">flaky-1.0-py3-none-any.whl</a>", {
          status: projectAttempts === 1 ? 503 : 200,
          headers: { "content-type": "text/html" },
        });
      },
      objectStoreFor: () => objectStore,
    });
    const repository = {
      ...repositoryFixture(),
      kind: "proxy" as const,
      config: {
        pypi: {
          upstreamUrl: "https://pypi.org/",
          upstreamUrlMode: "base-url",
          proxyPolicy: {
            upstreamRequestRetries: 1,
            upstreamRetryBaseDelayMs: 0,
            upstreamRetryMaxDelayMs: 0,
          },
        },
      },
    };

    await plugin.artifacts?.rebuildIndex({
      repository,
      objectStore,
      now: new Date("2026-08-05T00:00:00.000Z"),
    });
    const details = await plugin.artifacts?.rebuildIndex({
      repository,
      objectStore,
      now: new Date("2026-08-05T00:00:01.000Z"),
      continuation: { projectDetailOffset: 0 },
    });

    expect(projectAttempts).toBe(2);
    expect(Array.isArray(details) ? undefined : details?.result?.proxyIndex).toMatchObject({
      phase: "complete",
      failedProjectCount: 0,
    });
  });

  it("honors Retry-After when calculating retryable proxy upstream delay", () => {
    expect(pypiProxyRetryDelayMs(1, {
      upstreamFetchTimeoutMs: 10_000,
      upstreamRequestRetries: 2,
      upstreamRetryBaseDelayMs: 250,
      upstreamRetryMaxDelayMs: 5_000,
      indexCatalogBatchSize: 100,
      indexProjectDetailBatchSize: 100,
      failedProjectSampleLimit: 5,
      fileByteCache: {
        enabled: false,
        maxBytes: 0,
        maxTotalBytes: 0,
        ttlSeconds: 0,
        respectUpstreamCacheControl: true,
      },
    }, new Response("", {
      status: 429,
      headers: { "retry-after": "2" },
    }))).toBe(2_000);
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
        config: { pypi: { upstreamUrl: "https://pypi.org/", upstreamUrlMode: "base-url" } },
      },
      objectStore,
      now: new Date("2026-08-05T00:00:00.000Z"),
    });

    await expect(objectStore.getObject("repositories/python-internal/_proxy-cache/pypi/projects/removed.json"))
      .resolves.toBeNull();
  });

  it("aggregates PyPI group artifacts from the first member that provides each project", async () => {
    const plugin = createPypiGroupPlugin();
    const alphaHosted = repositoryArtifact({
      id: "artifact_alpha_hosted",
      repositoryName: "python-hosted",
      identity: "pypi:alpha:alpha-1.0-py3-none-any.whl",
      family: "pypi:alpha",
      name: "alpha",
      metadata: { project: "alpha", filename: "alpha-1.0-py3-none-any.whl" },
    });
    const alphaProxy = repositoryArtifact({
      id: "artifact_alpha_proxy",
      repositoryName: "python-proxy",
      identity: "pypi:proxy-file:alpha:alpha-2.0-py3-none-any.whl",
      family: "pypi:proxy-project:alpha",
      name: "alpha",
      metadata: { project: "alpha", filename: "alpha-2.0-py3-none-any.whl" },
    });
    const betaProxy = repositoryArtifact({
      id: "artifact_beta_proxy",
      repositoryName: "python-proxy",
      identity: "pypi:proxy-file:beta:beta-1.0-py3-none-any.whl",
      family: "pypi:proxy-project:beta",
      name: "beta",
      metadata: { project: "beta", filename: "beta-1.0-py3-none-any.whl" },
    });
    const artifacts = await plugin.artifacts?.rebuildIndex({
      repository: {
        ...repositoryFixture(),
        name: "python-group",
        kind: "group",
        config: { pypi: { members: ["python-hosted", "python-proxy"] } },
      },
      objectStore: new MemoryRepositoryObjectStore(),
      now: new Date("2026-08-10T00:00:00.000Z"),
      repositoryArtifactStore: {
        countByRepository: async () => 0,
        listByRepository: async (repositoryName) => ({
          "python-hosted": [alphaHosted],
          "python-proxy": [alphaProxy, betaProxy],
        }[repositoryName] ?? []),
        getById: async () => null,
        listFamiliesByRepositoryPage: async () => ({ records: [], totalFamilies: 0, totalArtifacts: 0 }),
        listByRepositoryPage: async (repositoryName, page) => {
          const records = {
            "python-hosted": [alphaHosted],
            "python-proxy": [alphaProxy, betaProxy],
          }[repositoryName] ?? [];
          return {
            records: records.slice(page.offset, page.offset + page.limit),
            total: records.length,
          };
        },
        listByRepositoryFamily: async () => [],
        upsert: async () => {},
        upsertMany: async () => {},
        replaceByRepository: async () => {},
      },
    });

    expect(Array.isArray(artifacts) ? artifacts.map((artifact) => ({
      repositoryName: artifact.repositoryName,
      family: artifact.family,
      sourceRepositoryName: artifact.metadata?.sourceRepositoryName,
      sourceArtifactId: artifact.metadata?.sourceArtifactId,
      filename: artifact.metadata?.filename,
    })) : []).toEqual([
      {
        repositoryName: "python-group",
        family: "pypi:group-project:alpha",
        sourceRepositoryName: "python-hosted",
        sourceArtifactId: "artifact_alpha_hosted",
        filename: "alpha-1.0-py3-none-any.whl",
      },
      {
        repositoryName: "python-group",
        family: "pypi:group-project:beta",
        sourceRepositoryName: "python-proxy",
        sourceArtifactId: "artifact_beta_proxy",
        filename: "beta-1.0-py3-none-any.whl",
      },
    ]);
  });

  it("slices PyPI group artifact aggregation across background job continuations", async () => {
    const plugin = createPypiGroupPlugin();
    const memberArtifacts = Array.from({ length: 260 }, (_, index) => {
      const project = `project-${String(index).padStart(3, "0")}`;
      return repositoryArtifact({
        id: `artifact_${project}`,
        repositoryName: "python-proxy",
        identity: `pypi:proxy-file:${project}:${project}-1.0-py3-none-any.whl`,
        family: `pypi:proxy-project:${project}`,
        name: project,
        metadata: { project, filename: `${project}-1.0-py3-none-any.whl` },
      });
    });
    const artifactStore = {
      countByRepository: async () => 0,
      listByRepository: async () => [],
      getById: async () => null,
      listFamiliesByRepositoryPage: async () => ({ records: [], totalFamilies: 0, totalArtifacts: 0 }),
      listByRepositoryPage: async (repositoryName: string, page: { limit: number; offset: number }) => ({
        records: repositoryName === "python-proxy"
          ? memberArtifacts.slice(page.offset, page.offset + page.limit)
          : [],
        total: repositoryName === "python-proxy" ? memberArtifacts.length : 0,
      }),
      listByRepositoryFamily: async () => [],
      upsert: async () => {},
      upsertMany: async () => {},
      replaceByRepository: async () => {},
    } satisfies RepositoryArtifactStore;

    const first = await plugin.artifacts?.rebuildIndex({
      repository: {
        ...repositoryFixture(),
        name: "python-group",
        kind: "group",
        config: { pypi: { members: ["python-proxy"] } },
      },
      objectStore: new MemoryRepositoryObjectStore(),
      now: new Date("2026-08-10T00:00:00.000Z"),
      repositoryArtifactStore: artifactStore,
    });

    expect(first).toMatchObject({
      complete: false,
      continuation: { memberIndex: 0, memberOffset: 250 },
      reset: true,
    });
    expect(Array.isArray(first) ? first : first?.artifacts).toHaveLength(250);

    const second = await plugin.artifacts?.rebuildIndex({
      repository: {
        ...repositoryFixture(),
        name: "python-group",
        kind: "group",
        config: { pypi: { members: ["python-proxy"] } },
      },
      objectStore: new MemoryRepositoryObjectStore(),
      now: new Date("2026-08-10T00:00:00.000Z"),
      repositoryArtifactStore: artifactStore,
      ...(Array.isArray(first) || first?.continuation === undefined ? {} : { continuation: first.continuation }),
    });

    expect(second).toMatchObject({ complete: true });
    expect(Array.isArray(second) ? second : second?.artifacts).toHaveLength(10);
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
      config: { pypi: { upstreamUrl: "https://pypi.org/", upstreamUrlMode: "base-url" } },
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
      config: { pypi: { upstreamUrl: "https://pypi.org/", upstreamUrlMode: "base-url" } },
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
      config: { pypi: { upstreamUrl: "https://pypi.org/", upstreamUrlMode: "base-url" } },
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
      config: { pypi: { upstreamUrl: "https://pypi.org/", upstreamUrlMode: "base-url" } },
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
      config: { pypi: { upstreamUrl: "https://pypi.org/", upstreamUrlMode: "base-url" } },
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
        config: { pypi: { upstreamUrl: "https://pypi.org/", upstreamUrlMode: "base-url" } },
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
