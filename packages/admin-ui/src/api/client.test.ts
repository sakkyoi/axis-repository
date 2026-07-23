import { describe, expect, it } from "vitest";
import { createAxisClient } from "./client";
import { serverErrorMessage } from "./http";
import {
  installInstructionsSchema,
  pypiClientInfoSchema,
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

  it("parses APT install instructions", () => {
    const instructions = installInstructionsSchema.parse({
      repository: "debian-internal",
      visibility: "private",
      keyUrl: "https://axis.example/repositories/debian-internal/apt/key.gpg",
      keyringPath: "/usr/share/keyrings/axis-debian-internal.gpg",
      sourceListPath: "/etc/apt/sources.list.d/axis-debian-internal.list",
      sourceLine:
        "deb [signed-by=/usr/share/keyrings/axis-debian-internal.gpg] https://axis.example/repositories/debian-internal noble main",
      authConfPath: "/etc/apt/auth.conf.d/axis-debian-internal.conf",
      authConfTemplate: "machine axis.example\nlogin axis\npassword <READ_TOKEN>\n",
      script: "# Configure credentials for private repository access.\nsudo apt update",
      commands: ["sudo apt update"],
    });

    expect(instructions.sourceLine).toContain("noble main");
    expect(instructions.authConfTemplate).toContain("<READ_TOKEN>");
  });

  it("parses PyPI client helper information", () => {
    const info = pypiClientInfoSchema.parse({
      repository: "python-internal",
      ecosystem: "pypi",
      simpleUrl: "https://axis.example/repositories/python-internal/simple/",
      pipIndexUrl: "https://axis.example/repositories/python-internal/simple/",
    });

    expect(info.pipIndexUrl).toBe("https://axis.example/repositories/python-internal/simple/");
  });

  it("parses repository plugin metadata", () => {
    const plugin = repositoryPluginSchema.parse({
      ecosystem: "apt",
      name: "apt-signed",
      version: "0.1.0",
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
  });

  it("uses APT-scoped endpoints for signing key import and generation", async () => {
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
          id: "signing_key_1",
          repositoryName: "debian-prod",
          name: "debian-prod",
          publicKeyArmored: "-----BEGIN PGP PUBLIC KEY BLOCK-----",
          fingerprint: "FINGERPRINT",
          keyId: "KEYID",
          createdAt: "2026-07-22T00:00:00.000Z",
          revokedAt: null,
        },
        status: 201,
        statusText: "Created",
        headers: {},
        config,
      };
    };

    await client.importAptSigningKey("debian-prod", {
      name: "debian-prod",
      privateKeyArmored: "private",
      passphrase: "secret",
    });
    await client.generateAptSigningKey("debian-prod", {
      name: "debian-generated",
      userIdName: "Axis Repository",
      userIdEmail: "axis@example.test",
    });

    expect(requests).toEqual([
      {
        method: "POST",
        url: "/admin/repositories/debian-prod/apt/signing-keys/import",
        data: {
          name: "debian-prod",
          privateKeyArmored: "private",
          passphrase: "secret",
        },
      },
      {
        method: "POST",
        url: "/admin/repositories/debian-prod/apt/signing-keys/generate",
        data: {
          name: "debian-generated",
          userIdName: "Axis Repository",
          userIdEmail: "axis@example.test",
        },
      },
    ]);
  });

  it("uses admin-scoped endpoints for APT client helper previews", async () => {
    const client = createAxisClient({
      baseUrl: "https://axis.example/",
      adminToken: "admin-secret",
    });
    const requests: string[] = [];
    client.http.defaults.adapter = async (config) => {
      requests.push(`${config.method?.toUpperCase()} ${config.url}`);
      if (String(config.url).endsWith("/key.gpg")) {
        return {
          data: "-----BEGIN PGP PUBLIC KEY BLOCK-----",
          status: 200,
          statusText: "OK",
          headers: {},
          config,
        };
      }
      if (String(config.url).endsWith("/source")) {
        return {
          data: {
            repository: "debian-private",
            ecosystem: "apt",
            baseUrl: "https://axis.example/repositories/debian-private",
            codename: "noble",
            components: ["main"],
            keyringPath: "/usr/share/keyrings/axis-debian-private.gpg",
            sourceLine:
              "deb [signed-by=/usr/share/keyrings/axis-debian-private.gpg] https://axis.example/repositories/debian-private noble main",
          },
          status: 200,
          statusText: "OK",
          headers: {},
          config,
        };
      }
      return {
        data: {
          repository: "debian-private",
          visibility: "private",
          keyUrl: "https://axis.example/repositories/debian-private/apt/key.gpg",
          keyringPath: "/usr/share/keyrings/axis-debian-private.gpg",
          sourceListPath: "/etc/apt/sources.list.d/axis-debian-private.list",
          sourceLine:
            "deb [signed-by=/usr/share/keyrings/axis-debian-private.gpg] https://axis.example/repositories/debian-private noble main",
          script: "# Configure credentials for private repository access.\nsudo apt update",
          commands: ["sudo apt update"],
        },
        status: 200,
        statusText: "OK",
        headers: {},
        config,
      };
    };

    await client.getAptSigningPublicKey("debian-private");
    await client.getAptSourceInfo("debian-private");
    await client.getAptInstallInstructions("debian-private");

    expect(requests).toEqual([
      "GET /admin/repositories/debian-private/apt/client/key.gpg",
      "GET /admin/repositories/debian-private/apt/client/source",
      "GET /admin/repositories/debian-private/apt/client/install",
    ]);
  });

  it("uses admin-scoped endpoints for PyPI client helper previews", async () => {
    const client = createAxisClient({
      baseUrl: "https://axis.example/",
      adminToken: "admin-secret",
    });
    const requests: string[] = [];
    client.http.defaults.adapter = async (config) => {
      requests.push(`${config.method?.toUpperCase()} ${config.url}`);
      return {
        data: {
          repository: "python-internal",
          ecosystem: "pypi",
          simpleUrl: "https://axis.example/repositories/python-internal/simple/",
          pipIndexUrl: "https://axis.example/repositories/python-internal/simple/",
        },
        status: 200,
        statusText: "OK",
        headers: {},
        config,
      };
    };

    const info = await client.getPypiClientInfo("python-internal");

    expect(info.pipIndexUrl).toBe("https://axis.example/repositories/python-internal/simple/");
    expect(requests).toEqual([
      "GET /admin/repositories/python-internal/pypi/client/simple-url",
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
});
