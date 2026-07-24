import { describe, expect, it } from "vitest";
import { createAxisClient } from "./client";
import { serverErrorMessage } from "./http";
import {
  publishSessionsResponseSchema,
  publishTokenCreateResponseSchema,
  repositoryPluginSchema,
  repositorySchema,
} from "./schemas";

describe("admin API schemas", () => {
  it("extracts API error messages from server error responses", () => {
    expect(serverErrorMessage({
      error: {
        code: "validation_error",
        message: "Repository already exists: debian-internal",
      },
    })).toBe("Repository already exists: debian-internal");
  });

  it("parses repositories with arbitrary plugin config", () => {
    const repository = repositorySchema.parse({
      id: "repo_1",
      name: "debian-internal",
      ecosystem: "apt",
      visibility: "private",
      config: {
        apt: {
          codename: "noble",
          components: ["main"],
          architectures: ["amd64"],
          signingKeyId: "signing_key_prod",
        },
      },
      createdAt: "2026-07-22T00:00:00.000Z",
      updatedAt: "2026-07-22T00:00:00.000Z",
    });

    expect(repository.name).toBe("debian-internal");
    expect(repository.config.apt).toMatchObject({ codename: "noble" });
  });

  it("parses one-time publish token secrets only from create responses", () => {
    const response = publishTokenCreateResponseSchema.parse({
      token: {
        id: "ptok_1",
        name: "github-actions",
        permissions: ["read", "publish"],
        repositories: ["debian-internal"],
        ecosystemScopes: {},
        signingKeyIds: [],
        createdAt: "2026-07-22T00:00:00.000Z",
      },
      secret: "axis_publish_secret",
    });

    expect(response.secret).toBe("axis_publish_secret");
    expect(response.token).not.toHaveProperty("tokenHash");
  });

  it("parses repository plugin metadata", () => {
    const plugin = repositoryPluginSchema.parse({
      ecosystem: "apt",
      name: "apt-signed",
      version: "0.1.0",
      enabled: true,
      catalogEnabled: true,
      enabledOverride: null,
      experimental: false,
      runtime: true,
      adminUi: true,
      capabilities: ["signed-release", "client-helpers"],
      clientHelpers: {
        namespace: "apt",
        actions: [
          {
            name: "install",
            label: "Install",
            responseKind: "shell",
            defaultOpen: true,
            public: true,
          },
        ],
      },
    });

    expect(plugin.clientHelpers?.actions).toEqual([
      {
        name: "install",
        label: "Install",
        responseKind: "shell",
        defaultOpen: true,
        public: true,
      },
    ]);
    expect(plugin).toMatchObject({
      enabled: true,
      catalogEnabled: true,
      enabledOverride: null,
    });
  });

  it("parses publish session responses", () => {
    const response = publishSessionsResponseSchema.parse({
      sessions: [
        {
          id: "pub_1",
          repositoryName: "debian-internal",
          ecosystem: "apt",
          status: "finalized",
          requestedBy: {
            tokenId: "tok_1",
            name: "ci",
            permissions: ["publish"],
            repositories: ["debian-internal"],
            ecosystemScopes: {},
            signingKeyIds: [],
          },
          artifacts: [
            {
              filename: "myapp_1.2.3_amd64.deb",
              size: 1234,
              sha256: "a".repeat(64),
              contentType: "application/vnd.debian.binary-package",
              metadata: { package: "myapp" },
            },
          ],
          uploads: [
            {
              uploadId: "upl_1",
              filename: "myapp_1.2.3_amd64.deb",
              objectKey: "_staging/uploads/pub_1/upl_1/myapp_1.2.3_amd64.deb",
              method: "PUT",
              url: "https://uploads.example/upl_1",
              headers: { "content-type": "application/vnd.debian.binary-package" },
              expiresAt: "2026-07-23T00:10:00.000Z",
            },
          ],
          verifiedUploads: [
            {
              uploadId: "upl_1",
              objectKey: "_staging/uploads/pub_1/upl_1/myapp_1.2.3_amd64.deb",
              size: 1234,
              sha256: "a".repeat(64),
              verifiedAt: "2026-07-23T00:02:00.000Z",
            },
          ],
          createdAt: "2026-07-23T00:00:00.000Z",
          expiresAt: "2026-07-23T00:10:00.000Z",
          finalizedAt: "2026-07-23T00:03:00.000Z",
          publishResult: {
            publishedAt: "2026-07-23T00:03:00.000Z",
            objects: [{ key: "repositories/debian-internal/dists/noble/Release", contentType: "text/plain" }],
          },
        },
      ],
    });

    expect(response.sessions[0]?.publishResult?.objects[0]?.key).toContain("Release");
  });
});

describe("createAxisClient", () => {
  it("creates an axios-backed client with normalized base URL and bearer auth", () => {
    const client = createAxisClient({
      baseUrl: "https://axis.example/",
      adminToken: "admin-secret",
    });

    expect(client.http.defaults.baseURL).toBe("https://axis.example");
    expect(client.http.defaults.headers.common.Authorization).toBe("Bearer admin-secret");
  });

  it("verifies admin tokens through the session endpoint", async () => {
    const client = createAxisClient({
      baseUrl: "https://axis.example/",
      adminToken: "admin-secret",
    });
    const requests: string[] = [];
    client.http.defaults.adapter = async (config) => {
      requests.push(`${config.method?.toUpperCase()} ${config.url}`);
      return {
        data: { ok: true },
        status: 200,
        statusText: "OK",
        headers: {},
        config,
      };
    };

    await client.verifyAdminToken();

    expect(requests).toEqual(["GET /admin/session"]);
  });

  it("creates repositories through the admin endpoint", async () => {
    const client = createAxisClient({
      baseUrl: "https://axis.example/",
      adminToken: "admin-secret",
    });
    const requests: Array<{ method: string; url: string; data: unknown }> = [];
    client.http.defaults.adapter = async (config) => {
      requests.push({
        method: config.method?.toUpperCase() ?? "",
        url: config.url ?? "",
        data: config.data ? JSON.parse(String(config.data)) : undefined,
      });
      return {
        data: {
          id: "repo_1",
          name: "debian-internal",
          ecosystem: "apt",
          visibility: "private",
          config: { apt: { codename: "noble" } },
          createdAt: "2026-07-22T00:00:00.000Z",
          updatedAt: "2026-07-22T00:00:00.000Z",
        },
        status: 201,
        statusText: "Created",
        headers: {},
        config,
      };
    };

    const repository = await client.createRepository({
      name: "debian-internal",
      ecosystem: "apt",
      visibility: "private",
      config: { apt: { codename: "noble" } },
    });

    expect(repository.name).toBe("debian-internal");
    expect(requests).toEqual([
      {
        method: "POST",
        url: "/admin/repositories",
        data: {
          name: "debian-internal",
          ecosystem: "apt",
          visibility: "private",
          config: { apt: { codename: "noble" } },
        },
      },
    ]);
  });

  it("lists repository plugin metadata through the admin endpoint", async () => {
    const client = createAxisClient({
      baseUrl: "https://axis.example/",
      adminToken: "admin-secret",
    });
    const requests: string[] = [];
    client.http.defaults.adapter = async (config) => {
      requests.push(`${config.method?.toUpperCase()} ${config.url}`);
      return {
        data: {
          plugins: [
            {
              ecosystem: "apt",
              name: "apt-signed",
              version: "0.1.0",
              enabled: true,
              catalogEnabled: true,
              enabledOverride: null,
              experimental: false,
              runtime: true,
              adminUi: true,
              capabilities: ["signed-release", "client-helpers"],
              clientHelpers: {
                namespace: "apt",
                actions: [
                  {
                    name: "install",
                    label: "Install",
                    responseKind: "shell",
                    defaultOpen: true,
                    public: true,
                  },
                ],
              },
            },
          ],
        },
        status: 200,
        statusText: "OK",
        headers: {},
        config,
      };
    };

    const plugins = await client.listRepositoryPlugins();

    expect(requests).toEqual(["GET /admin/repository-plugins"]);
    expect(plugins.map((plugin) => plugin.ecosystem)).toEqual(["apt"]);
    expect(plugins[0]).toMatchObject({
      enabled: true,
      catalogEnabled: true,
      enabledOverride: null,
      experimental: false,
      runtime: true,
      adminUi: true,
    });
  });

  it("updates repository plugin policy overrides through the admin endpoint", async () => {
    const client = createAxisClient({
      baseUrl: "https://axis.example/",
      adminToken: "admin-secret",
    });
    const requests: Array<{ method: string; url: string; data: unknown }> = [];
    client.http.defaults.adapter = async (config) => {
      requests.push({
        method: config.method?.toUpperCase() ?? "",
        url: config.url ?? "",
        data: config.data ? JSON.parse(String(config.data)) : undefined,
      });
      return {
        data: {
          ecosystem: "apt",
          name: "apt-signed",
          version: "0.1.0",
          enabled: false,
          catalogEnabled: true,
          enabledOverride: false,
          experimental: false,
          runtime: true,
          adminUi: true,
          capabilities: ["signed-release"],
        },
        status: 200,
        statusText: "OK",
        headers: {},
        config,
      };
    };

    await expect(client.updateRepositoryPluginPolicy("apt", { enabled: false }))
      .resolves.toMatchObject({ ecosystem: "apt", enabled: false, enabledOverride: false });
    expect(requests).toEqual([
      {
        method: "PATCH",
        url: "/admin/repository-plugins/apt",
        data: { enabled: false },
      },
    ]);
  });

  it("uses a generic admin-scoped endpoint for repository client helpers", async () => {
    const client = createAxisClient({
      baseUrl: "https://axis.example/",
      adminToken: "admin-secret",
    });
    const requests: string[] = [];
    client.http.defaults.adapter = async (config) => {
      requests.push(`${config.method?.toUpperCase()} ${config.url}`);
      return {
        data: { script: "pip install demo" },
        status: 200,
        statusText: "OK",
        headers: {},
        config,
      };
    };

    await expect(client.getRepositoryClientHelper("python-internal", "pypi", "simple-url"))
      .resolves.toEqual({ script: "pip install demo" });
    expect(requests).toEqual([
      "GET /admin/repositories/python-internal/pypi/client/simple-url",
    ]);
  });

  it("uses generic admin-scoped endpoints for repository plugin resources", async () => {
    const client = createAxisClient({
      baseUrl: "https://axis.example/",
      adminToken: "admin-secret",
    });
    const requests: Array<{ method: string; url: string; data: unknown }> = [];
    client.http.defaults.adapter = async (config) => {
      requests.push({
        method: config.method?.toUpperCase() ?? "",
        url: config.url ?? "",
        data: config.data ? JSON.parse(String(config.data)) : undefined,
      });
      return {
        data: { ok: true },
        status: 200,
        statusText: "OK",
        headers: {},
        config,
      };
    };

    await expect(client.getRepositoryPluginResource("debian prod", "apt", ["signing-keys", "key 1"]))
      .resolves.toEqual({ ok: true });
    await expect(client.postRepositoryPluginResource("debian prod", "apt", ["signing-keys", "generate"], { name: "release" }))
      .resolves.toEqual({ ok: true });

    expect(requests).toEqual([
      {
        method: "GET",
        url: "/admin/repositories/debian%20prod/apt/signing-keys/key%201",
        data: undefined,
      },
      {
        method: "POST",
        url: "/admin/repositories/debian%20prod/apt/signing-keys/generate",
        data: { name: "release" },
      },
    ]);
  });

  it("lists publish sessions through the publish API endpoint", async () => {
    const client = createAxisClient({
      baseUrl: "https://axis.example/",
      adminToken: "admin-secret",
    });
    const requests: string[] = [];
    client.http.defaults.adapter = async (config) => {
      requests.push(`${config.method?.toUpperCase()} ${config.url}`);
      return {
        data: {
          sessions: [
            {
              id: "pub_1",
              repositoryName: "debian-internal",
              ecosystem: "apt",
              status: "pending_uploads",
              requestedBy: {
                tokenId: "tok_1",
                name: "ci",
                permissions: ["publish"],
                repositories: ["debian-internal"],
                ecosystemScopes: {},
                signingKeyIds: [],
              },
              artifacts: [],
              uploads: [],
              verifiedUploads: [],
              createdAt: "2026-07-23T00:00:00.000Z",
              expiresAt: "2026-07-23T00:10:00.000Z",
            },
          ],
        },
        status: 200,
        statusText: "OK",
        headers: {},
        config,
      };
    };

    const sessions = await client.listPublishSessions();

    expect(requests).toEqual(["GET /admin/publish-sessions"]);
    expect(sessions).toMatchObject([{ id: "pub_1", repositoryName: "debian-internal" }]);
  });

  it("creates, uploads, verifies, and finalizes admin publish sessions", async () => {
    const client = createAxisClient({
      baseUrl: "https://axis.example/",
      adminToken: "admin-secret",
    });
    const requests: Array<{ method: string; url: string; data?: unknown; headers?: unknown }> = [];
    client.http.defaults.adapter = async (config) => {
      requests.push({
        method: config.method?.toUpperCase() ?? "",
        url: config.url ?? "",
        data: typeof config.data === "string" ? JSON.parse(config.data) : undefined,
        headers: config.headers,
      });
      if (config.url === "https://uploads.example/upl_1") {
        return { data: "", status: 200, statusText: "OK", headers: {}, config };
      }
      if (config.url === "/admin/publish-sessions") {
        return {
          data: {
            id: "pub_1",
            repositoryName: "debian-internal",
            ecosystem: "apt",
            status: "pending_uploads",
            requestedBy: {
              tokenId: "admin",
              name: "admin",
              permissions: ["publish"],
              repositories: ["debian-internal"],
              ecosystemScopes: {},
              signingKeyIds: ["signing_key_1"],
            },
            artifacts: [],
            uploads: [{
              uploadId: "upl_1",
              filename: "myapp_1.2.3_amd64.deb",
              objectKey: "_staging/uploads/pub_1/upl_1/myapp_1.2.3_amd64.deb",
              method: "PUT",
              url: "https://uploads.example/upl_1",
              headers: { "content-type": "application/vnd.debian.binary-package" },
              expiresAt: "2026-07-23T00:10:00.000Z",
            }],
            verifiedUploads: [],
            createdAt: "2026-07-23T00:00:00.000Z",
            expiresAt: "2026-07-23T00:10:00.000Z",
          },
          status: 201,
          statusText: "Created",
          headers: {},
          config,
        };
      }
      return {
        data: {
          session: {
            id: "pub_1",
            repositoryName: "debian-internal",
            ecosystem: "apt",
            status: "finalized",
            requestedBy: {
              tokenId: "admin",
              name: "admin",
              permissions: ["publish"],
              repositories: ["debian-internal"],
              ecosystemScopes: {},
              signingKeyIds: ["signing_key_1"],
            },
            artifacts: [],
            uploads: [],
            verifiedUploads: [],
            createdAt: "2026-07-23T00:00:00.000Z",
            expiresAt: "2026-07-23T00:10:00.000Z",
          },
          result: { publishedAt: "2026-07-23T00:01:00.000Z", objects: [] },
        },
        status: 200,
        statusText: "OK",
        headers: {},
        config,
      };
    };

    const session = await client.createAdminPublishSession({
      repositoryName: "debian-internal",
      ecosystem: "apt",
      artifacts: [{
        filename: "myapp_1.2.3_amd64.deb",
        size: 3,
        sha256: "a".repeat(64),
        contentType: "application/vnd.debian.binary-package",
        metadata: { package: "myapp" },
      }],
    });
    await client.uploadPublishArtifact(session.uploads[0]!, new Blob(["deb"]));
    await client.verifyAdminPublishUpload(session.id, "upl_1");
    await client.finalizeAdminPublishSession(session.id);

    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      "POST /admin/publish-sessions",
      "PUT https://uploads.example/upl_1",
      "POST /admin/publish-sessions/pub_1/uploads/upl_1/verify",
      "POST /admin/publish-sessions/pub_1/finalize",
    ]);
  });
});
