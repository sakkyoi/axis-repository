import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { ArtifactPublisherRegistry } from "./artifact-publisher-registry";
import { createDevDependencyHarness } from "./dev-dependencies";
import type { MemoryRepositoryObjectStore } from "./repository-object-store";

afterEach(() => {
  vi.doUnmock("./app");
  vi.resetModules();
});

async function createPublishSession(
  app: ReturnType<typeof createApp>,
  repositoryObjectStore?: MemoryRepositoryObjectStore,
) {
  const { generateKey } = await import("openpgp");
  const key = await generateKey({
    type: "ecc",
    curve: "curve25519Legacy",
    userIDs: [{ name: "Axis Test", email: "axis@example.test" }],
    passphrase: "correct-passphrase",
  });

  const signingKeyResponse = await app.fetch(
    new Request("https://axis.example/admin/repositories/debian-internal/apt/signing-keys/import", {
      method: "POST",
      headers: {
        authorization: "Bearer dev-admin-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "debian-prod",
        privateKeyArmored: key.privateKey,
        passphrase: "correct-passphrase",
      }),
    }),
  );
  expect(signingKeyResponse.status).toBe(201);
  const signingKey = (await signingKeyResponse.json()) as { id: string };

  const repositoryResponse = await app.fetch(
    new Request("https://axis.example/admin/repositories", {
      method: "POST",
      headers: {
        authorization: "Bearer dev-admin-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "debian-internal",
        ecosystem: "apt",
        config: {
          apt: {
            codename: "noble",
            components: ["main"],
            architectures: ["amd64"],
            signingKeyId: signingKey.id,
          },
        },
      }),
    }),
  );
  expect(repositoryResponse.status).toBe(201);

  const tokenResponse = await app.fetch(
    new Request("https://axis.example/admin/publish-tokens", {
      method: "POST",
      headers: {
        authorization: "Bearer dev-admin-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "github-actions",
        repositories: ["debian-internal"],
        permissions: ["publish"],
        ecosystemScopes: { apt: { allowedPackages: ["myapp"] } },
        signingKeyIds: [signingKey.id],
      }),
    }),
  );
  expect(tokenResponse.status).toBe(201);
  const tokenBody = (await tokenResponse.json()) as { secret: string };

  const sessionResponse = await app.fetch(
    new Request("https://axis.example/api/publish-sessions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${tokenBody.secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        repositoryName: "debian-internal",
        ecosystem: "apt",
        artifacts: [
          {
            filename: "myapp_1.2.3_amd64.deb",
            size: 1234,
            sha256: "a".repeat(64),
            contentType: "application/vnd.debian.binary-package",
            metadata: {
              package: "myapp",
              version: "1.2.3",
              architecture: "amd64",
              component: "main",
              description: "Example package",
              maintainer: "Release Team <release@example.com>",
            },
          },
        ],
      }),
    }),
  );
  expect(sessionResponse.status).toBe(201);
  const session = (await sessionResponse.json()) as {
    id: string;
    uploads: Array<{ uploadId: string; objectKey: string }>;
  };
  if (repositoryObjectStore) {
    for (const upload of session.uploads) {
      await repositoryObjectStore.putBytes(
        upload.objectKey,
        new Uint8Array(1234),
        "application/vnd.debian.binary-package",
      );
    }
  }

  return { token: tokenBody.secret, session };
}

function readStoredText(store: MemoryRepositoryObjectStore, key: string): string {
  const object = [...store.objects].reverse().find((candidate) => candidate.key === key);
  if (!object) {
    throw new Error(`Expected stored object: ${key}`);
  }
  if (typeof object.value !== "string") {
    throw new Error(`Expected stored text object: ${key}`);
  }
  return object.value;
}

function validAptConfig(signingKeyId = "signing_key_prod"): Record<string, unknown> {
  return {
    apt: {
      codename: "noble",
      components: ["main"],
      architectures: ["amd64"],
      signingKeyId,
    },
  };
}

async function createRepository(app: ReturnType<typeof createApp>, body: Record<string, unknown>) {
  const requestBody = body.ecosystem === "apt" && body.config === undefined
    ? { ...body, config: validAptConfig() }
    : body;
  const response = await app.fetch(
    new Request("https://axis.example/admin/repositories", {
      method: "POST",
      headers: {
        authorization: "Bearer dev-admin-token",
        "content-type": "application/json",
      },
      body: JSON.stringify(requestBody),
    }),
  );
  expect(response.status).toBe(201);
}

async function createToken(app: ReturnType<typeof createApp>, body: Record<string, unknown>): Promise<string> {
  const response = await app.fetch(
    new Request("https://axis.example/admin/publish-tokens", {
      method: "POST",
      headers: {
        authorization: "Bearer dev-admin-token",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  );
  expect(response.status).toBe(201);
  const result = (await response.json()) as { secret: string };
  return result.secret;
}

async function createSigningKey(app: ReturnType<typeof createApp>): Promise<{ id: string; publicKeyArmored: string }> {
  const { generateKey } = await import("openpgp");
  const key = await generateKey({
    type: "ecc",
    curve: "curve25519Legacy",
    userIDs: [{ name: "Axis Test", email: "axis@example.test" }],
    passphrase: "correct-passphrase",
  });
  const response = await app.fetch(
    new Request("https://axis.example/admin/repositories/debian-internal/apt/signing-keys/import", {
      method: "POST",
      headers: {
        authorization: "Bearer dev-admin-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: `debian-prod-${crypto.randomUUID()}`,
        privateKeyArmored: key.privateKey,
        passphrase: "correct-passphrase",
      }),
    }),
  );
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string; publicKeyArmored: string };
}

function basicAuth(secret: string, username = "axis"): string {
  return `Basic ${btoa(`${username}:${secret}`)}`;
}

describe("Cloudflare runtime routes", () => {
  it("responds to health checks", async () => {
    const app = createApp();
    const response = await app.fetch(new Request("https://axis.example/health"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, service: "axis-repository" });
  });

  it("returns not found for unknown API routes", async () => {
    const app = createApp();
    const response = await app.fetch(new Request("https://axis.example/api/missing"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "not_found", message: "Not Found" },
    });
  });

  it("redirects root requests to the admin UI namespace", async () => {
    const app = createApp();
    const response = await app.fetch(new Request("https://axis.example/"));

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/ui/");
  });

  it("redirects bare admin UI namespace requests to the canonical trailing slash", async () => {
    const app = createApp();
    const response = await app.fetch(new Request("https://axis.example/ui"));

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/ui/");
  });

  it("serves the admin UI shell under the /ui namespace", async () => {
    const app = createApp();
    const response = await app.fetch(new Request("https://axis.example/ui/repositories"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const html = await response.text();
    expect(html).toContain('<div id="root">');
    expect(html).toContain("window.__AXIS_ADMIN_CONFIG__");
    expect(html.indexOf("window.__AXIS_ADMIN_CONFIG__")).toBeLessThan(html.indexOf('src="/assets/'));
  });

  it("injects the configured admin UI API base URL into the shell", async () => {
    const app = createApp(
      createDevDependencyHarness(
        "dev-admin-token",
        "dev-signing-key-encryption-secret",
        { apiBaseUrl: "https://admin-api.example/base" },
      ).dependencies,
    );
    const response = await app.fetch(new Request("https://axis.example/ui/settings"));

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain('"apiBaseUrl":"https://admin-api.example/base"');
  });

  it("serves admin UI assets without taking over API routes", async () => {
    const app = createApp();

    const shell = await app.fetch(new Request("https://axis.example/ui/"));
    const shellHtml = await shell.text();
    const assetPath = shellHtml.match(/src="([^"]+\.js)"/)?.[1];
    expect(assetPath).toMatch(/^\/assets\/index-.+\.js$/);

    const asset = await app.fetch(new Request(`https://axis.example${assetPath}`));
    const api = await app.fetch(new Request("https://axis.example/admin/repositories"));

    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toBe("application/javascript; charset=utf-8");
    await expect(asset.text()).resolves.toContain("createRoot");
    expect(api.status).toBe(401);
  });

  it("does not serve the admin UI shell for reserved namespace roots", async () => {
    const app = createApp();

    const admin = await app.fetch(new Request("https://axis.example/admin"));
    const api = await app.fetch(new Request("https://axis.example/api"));
    const repositories = await app.fetch(new Request("https://axis.example/repositories"));

    expect(admin.status).toBe(404);
    expect(api.status).toBe(404);
    expect(repositories.status).toBe(404);
    expect(admin.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(api.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(repositories.headers.get("content-type")).toBe("application/json; charset=utf-8");
  });

  it("does not serve the admin UI shell for non-namespaced login routes", async () => {
    const app = createApp();

    const response = await app.fetch(new Request("https://axis.example/login"));

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
  });

  it("reuses the default app across worker fetches", async () => {
    vi.resetModules();
    const fetch = vi.fn(async () => new Response("ok"));
    const createApp = vi.fn(() => ({ fetch }));
    vi.doMock("./app", () => ({ createApp }));

    const worker = (await import("./index")).default;
    await worker.fetch(new Request("https://axis.example/first"));
    await worker.fetch(new Request("https://axis.example/second"));

    expect(createApp).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("creates and lists repositories through admin routes", async () => {
    const app = createApp();

    const createResponse = await app.fetch(
      new Request("https://axis.example/admin/repositories", {
        method: "POST",
        headers: {
          authorization: "Bearer dev-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "debian-internal",
          ecosystem: "apt",
          visibility: "private",
          config: validAptConfig(),
        }),
      }),
    );

    expect(createResponse.status).toBe(201);
    await expect(createResponse.json()).resolves.toMatchObject({
      name: "debian-internal",
      ecosystem: "apt",
      visibility: "private",
      config: validAptConfig(),
    });

    const listResponse = await app.fetch(
      new Request("https://axis.example/admin/repositories", {
        headers: { authorization: "Bearer dev-admin-token" },
      }),
    );

    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      repositories: [{ name: "debian-internal", ecosystem: "apt" }],
    });
  });

  it("rejects admin repository routes without admin token", async () => {
    const app = createApp();
    const response = await app.fetch(new Request("https://axis.example/admin/repositories"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "unauthorized", message: "Unauthorized" },
    });
  });

  it("verifies valid admin tokens through the admin session route", async () => {
    const app = createApp();
    const response = await app.fetch(
      new Request("https://axis.example/admin/session", {
        headers: { authorization: "Bearer dev-admin-token" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("rejects invalid admin tokens through the admin session route", async () => {
    const app = createApp();
    const response = await app.fetch(
      new Request("https://axis.example/admin/session", {
        headers: { authorization: "Bearer wrong-token" },
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "unauthorized", message: "Unauthorized" },
    });
  });

  it("rejects invalid repository visibility", async () => {
    const app = createApp();
    const response = await app.fetch(
      new Request("https://axis.example/admin/repositories", {
        method: "POST",
        headers: {
          authorization: "Bearer dev-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "debian-internal",
          ecosystem: "apt",
          visibility: "invalid",
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "validation_error", message: "visibility must be private or public" },
    });
  });

  it("creates pypi repositories when the PyPI plugin is enabled", async () => {
    const app = createApp();
    const response = await app.fetch(
      new Request("https://axis.example/admin/repositories", {
        method: "POST",
        headers: {
          authorization: "Bearer dev-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "python-internal",
          ecosystem: "pypi",
          visibility: "private",
          config: {},
        }),
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      name: "python-internal",
      ecosystem: "pypi",
      visibility: "private",
      config: {},
    });
  });

  it("lists repository plugin metadata through admin routes", async () => {
    const app = createApp();

    const response = await app.fetch(
      new Request("https://axis.example/admin/repository-plugins", {
        headers: { authorization: "Bearer dev-admin-token" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
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
          capabilities: ["apt", "signed-release", "pool-copy", "serve:dists", "serve:pool"],
          clientHelpers: {
            namespace: "apt",
            actions: [
              {
                name: "key.gpg",
                label: "key.gpg",
                responseKind: "text",
                defaultOpen: false,
                public: true,
              },
              {
                name: "source",
                label: "source",
                responseKind: "json",
                defaultOpen: false,
                public: true,
              },
              {
                name: "install",
                label: "install",
                responseKind: "shell",
                defaultOpen: true,
                public: true,
              },
            ],
          },
        },
        {
          ecosystem: "pypi",
          name: "pypi-simple",
          version: "0.1.0",
          enabled: true,
          catalogEnabled: true,
          enabledOverride: null,
          experimental: true,
          runtime: true,
          adminUi: true,
          capabilities: ["pypi", "simple-api", "serve:simple", "client-helpers"],
          clientHelpers: {
            namespace: "pypi",
            actions: [
              {
                name: "simple-url",
                label: "Simple API URL",
                responseKind: "text",
                defaultOpen: true,
                public: true,
                displayPath: "simpleUrl",
              },
            ],
          },
        },
      ],
    });
  });

  it("updates repository plugin policy overrides through admin routes", async () => {
    const app = createApp();

    const disableResponse = await app.fetch(
      new Request("https://axis.example/admin/repository-plugins/apt", {
        method: "PATCH",
        headers: {
          authorization: "Bearer dev-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ enabled: false }),
      }),
    );

    expect(disableResponse.status).toBe(200);
    await expect(disableResponse.json()).resolves.toMatchObject({
      ecosystem: "apt",
      enabled: false,
      catalogEnabled: true,
      enabledOverride: false,
    });

    const listResponse = await app.fetch(
      new Request("https://axis.example/admin/repository-plugins", {
        headers: { authorization: "Bearer dev-admin-token" },
      }),
    );

    expect(listResponse.status).toBe(200);
    const listBody = (await listResponse.json()) as { plugins: Array<Record<string, unknown>> };
    expect(listBody.plugins).toEqual(expect.arrayContaining([
      expect.objectContaining(
        {
          ecosystem: "apt",
          enabled: false,
          catalogEnabled: true,
          enabledOverride: false,
        },
      ),
      ]));

    const resetResponse = await app.fetch(
      new Request("https://axis.example/admin/repository-plugins/apt", {
        method: "PATCH",
        headers: {
          authorization: "Bearer dev-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ enabled: null }),
      }),
    );

    expect(resetResponse.status).toBe(200);
    await expect(resetResponse.json()).resolves.toMatchObject({
      ecosystem: "apt",
      enabled: true,
      catalogEnabled: true,
      enabledOverride: null,
    });
  });

  it("allows policy overrides for uncataloged runtime plugins reported in repository plugin metadata", async () => {
    const harness = createDevDependencyHarness();
    harness.dependencies.artifactPublisherRegistry.register({
      ecosystem: "demo",
      name: "demo-plugin",
      version: "0.1.0",
      capabilities: ["admin-resources"],
      publisher: { publish: async () => ({ publishedAt: "2026-07-23T00:00:00.000Z", objects: [] }) },
      canServeRepositoryPath: () => false,
      validateRepositoryConfig: () => {},
      validatePublishArtifacts: () => {},
      authorizePublish: () => {},
    });
    const app = createApp(harness.dependencies);

    const response = await app.fetch(
      new Request("https://axis.example/admin/repository-plugins/demo", {
        method: "PATCH",
        headers: {
          authorization: "Bearer dev-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ enabled: false }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ecosystem: "demo",
      enabled: false,
      catalogEnabled: true,
      enabledOverride: false,
    });
  });

  it("fails closed for repository creation when a plugin is disabled by policy", async () => {
    const app = createApp();

    await app.fetch(
      new Request("https://axis.example/admin/repository-plugins/apt", {
        method: "PATCH",
        headers: {
          authorization: "Bearer dev-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ enabled: false }),
      }),
    );

    const response = await app.fetch(
      new Request("https://axis.example/admin/repositories", {
        method: "POST",
        headers: {
          authorization: "Bearer dev-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "debian-internal",
          ecosystem: "apt",
          visibility: "private",
          config: validAptConfig(),
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "validation_error",
        message: "Repository plugin is disabled: apt",
      },
    });
  });

  it("fails closed for repository object serving when a plugin is disabled by policy", async () => {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    await createRepository(app, {
      name: "debian-public",
      ecosystem: "apt",
      visibility: "public",
      config: validAptConfig(),
    });
    await harness.repositoryObjectStore.putText(
      "repositories/debian-public/dists/noble/Release",
      "Origin: Axis\n",
      "text/plain; charset=utf-8",
    );

    await app.fetch(
      new Request("https://axis.example/admin/repository-plugins/apt", {
        method: "PATCH",
        headers: {
          authorization: "Bearer dev-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ enabled: false }),
      }),
    );

    const response = await app.fetch(
      new Request("https://axis.example/repositories/debian-public/dists/noble/Release"),
    );

    expect(response.status).toBe(404);
  });

  it("dispatches admin repository plugin resources through the repository plugin", async () => {
    const harness = createDevDependencyHarness();
    harness.dependencies.artifactPublisherRegistry.register({
      ecosystem: "demo",
      name: "demo-plugin",
      version: "0.1.0",
      capabilities: ["admin-resources"],
      publisher: { publish: async () => ({ publishedAt: "2026-07-23T00:00:00.000Z", objects: [] }) },
      canServeRepositoryPath: () => false,
      validateRepositoryConfig: () => {},
      validatePublishArtifacts: () => {},
      authorizePublish: () => {},
      adminResources: {
        namespace: "demo",
        handle: async ({ repository, path }) => new Response(JSON.stringify({
          repository: repository!.name,
          path,
        }), {
          headers: { "content-type": "application/json; charset=utf-8" },
        }),
      },
    });
    const app = createApp(harness.dependencies);
    await createRepository(app, { name: "demo-repo", ecosystem: "demo", config: { demo: {} } });

    const response = await app.fetch(new Request("https://axis.example/admin/repositories/demo-repo/demo/status", {
      headers: { authorization: "Bearer dev-admin-token" },
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      repository: "demo-repo",
      path: ["status"],
    });
  });

  it("requires admin auth before listing repository plugin metadata", async () => {
    const app = createApp();

    const response = await app.fetch(new Request("https://axis.example/admin/repository-plugins"));

    expect(response.status).toBe(401);
  });

  it("lists catalog plugins even when runtime metadata is not registered", async () => {
    const harness = createDevDependencyHarness();
    harness.dependencies.artifactPublisherRegistry = new ArtifactPublisherRegistry();
    const app = createApp(harness.dependencies);

    const response = await app.fetch(
      new Request("https://axis.example/admin/repository-plugins", {
        headers: { authorization: "Bearer dev-admin-token" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      plugins: [
        {
          ecosystem: "apt",
          enabled: true,
          experimental: false,
          runtime: true,
          adminUi: true,
          name: "apt-signed",
          version: "0.1.0",
          capabilities: ["apt", "signed-release", "pool-copy", "serve:dists", "serve:pool"],
        },
        {
          ecosystem: "pypi",
          enabled: true,
          experimental: true,
          runtime: true,
          adminUi: true,
          name: "pypi-simple",
          version: "0.1.0",
          capabilities: ["pypi", "simple-api", "serve:simple", "client-helpers"],
        },
      ],
    });
  });

  it("rejects creating apt repositories with invalid config", async () => {
    const app = createApp();
    const response = await app.fetch(
      new Request("https://axis.example/admin/repositories", {
        method: "POST",
        headers: {
          authorization: "Bearer dev-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "debian-internal",
          ecosystem: "apt",
          config: {
            apt: {
              codename: "noble",
              components: ["main"],
              architectures: ["amd64"],
            },
          },
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "validation_error", message: "config.apt.signingKeyId is required" },
    });
  });

  it("gets repositories by name through admin routes", async () => {
    const app = createApp();
    await createRepository(app, {
      name: "debian-internal",
      ecosystem: "apt",
      visibility: "private",
      config: validAptConfig(),
    });

    const response = await app.fetch(
      new Request("https://axis.example/admin/repositories/debian-internal", {
        headers: { authorization: "Bearer dev-admin-token" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      name: "debian-internal",
      ecosystem: "apt",
      visibility: "private",
      config: validAptConfig(),
    });
  });

  it("updates repository visibility and config through admin routes", async () => {
    const app = createApp();
    const signingKey = await createSigningKey(app);
    await createRepository(app, {
      name: "debian-internal",
      ecosystem: "apt",
      visibility: "private",
      config: validAptConfig(signingKey.id),
    });

    const response = await app.fetch(
      new Request("https://axis.example/admin/repositories/debian-internal", {
        method: "PATCH",
        headers: {
          authorization: "Bearer dev-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          visibility: "public",
          config: {
            apt: {
              codename: "jammy",
              components: ["main", "contrib"],
              architectures: ["amd64"],
              signingKeyId: signingKey.id,
            },
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      name: "debian-internal",
      ecosystem: "apt",
      visibility: "public",
      config: {
        apt: {
          codename: "jammy",
          components: ["main", "contrib"],
          architectures: ["amd64"],
          signingKeyId: signingKey.id,
        },
      },
    });
  });

  it("rejects immutable repository fields on admin updates", async () => {
    const app = createApp();
    await createRepository(app, {
      name: "debian-internal",
      ecosystem: "apt",
      config: validAptConfig(),
    });

    const response = await app.fetch(
      new Request("https://axis.example/admin/repositories/debian-internal", {
        method: "PATCH",
        headers: {
          authorization: "Bearer dev-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "renamed", ecosystem: "pypi" }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "validation_error", message: "Repository name and ecosystem are immutable" },
    });
  });

  it("validates repository config on admin updates", async () => {
    const app = createApp();
    await createRepository(app, {
      name: "debian-internal",
      ecosystem: "apt",
      config: validAptConfig(),
    });

    const response = await app.fetch(
      new Request("https://axis.example/admin/repositories/debian-internal", {
        method: "PATCH",
        headers: {
          authorization: "Bearer dev-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          config: {
            apt: {
              codename: "noble",
              components: ["main"],
              architectures: ["amd64"],
            },
          },
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "validation_error", message: "config.apt.signingKeyId is required" },
    });
  });

  it("serves the apt repository signing public key", async () => {
    const app = createApp();
    const signingKey = await createSigningKey(app);
    await createRepository(app, {
      name: "debian-public",
      ecosystem: "apt",
      visibility: "public",
      config: validAptConfig(signingKey.id),
    });

    const response = await app.fetch(
      new Request("https://axis.example/repositories/debian-public/apt/key.gpg"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pgp-keys");
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    await expect(response.text()).resolves.toBe(signingKey.publicKeyArmored);
  });

  it("serves private apt signing keys without read auth", async () => {
    const app = createApp();
    const signingKey = await createSigningKey(app);
    await createRepository(app, {
      name: "debian-private",
      ecosystem: "apt",
      visibility: "private",
      config: validAptConfig(signingKey.id),
    });

    const response = await app.fetch(
      new Request("https://axis.example/repositories/debian-private/apt/key.gpg"),
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe(signingKey.publicKeyArmored);
  });

  it("serves private apt client helpers through admin-scoped endpoints", async () => {
    const app = createApp();
    const signingKey = await createSigningKey(app);
    await createRepository(app, {
      name: "debian-private",
      ecosystem: "apt",
      visibility: "private",
      config: validAptConfig(signingKey.id),
    });

    const keyResponse = await app.fetch(
      new Request("https://axis.example/admin/repositories/debian-private/apt/client/key.gpg", {
        headers: { authorization: "Bearer dev-admin-token" },
      }),
    );
    const sourceResponse = await app.fetch(
      new Request("https://axis.example/admin/repositories/debian-private/apt/client/source", {
        headers: { authorization: "Bearer dev-admin-token" },
      }),
    );
    const installResponse = await app.fetch(
      new Request("https://axis.example/admin/repositories/debian-private/apt/client/install", {
        headers: { authorization: "Bearer dev-admin-token" },
      }),
    );

    expect(keyResponse.status).toBe(200);
    await expect(keyResponse.text()).resolves.toBe(signingKey.publicKeyArmored);
    expect(sourceResponse.status).toBe(200);
    await expect(sourceResponse.json()).resolves.toMatchObject({
      repository: "debian-private",
      sourceLine:
        "deb [signed-by=/usr/share/keyrings/axis-debian-private.gpg] https://axis.example/repositories/debian-private noble main",
    });
    expect(installResponse.status).toBe(200);
    await expect(installResponse.json()).resolves.toMatchObject({
      repository: "debian-private",
      visibility: "private",
      authConfTemplate: "machine axis.example\nlogin axis\npassword <READ_TOKEN>\n",
    });
  });

  it("also serves private apt signing keys when basic read-token auth is present", async () => {
    const app = createApp();
    const signingKey = await createSigningKey(app);
    await createRepository(app, {
      name: "debian-private",
      ecosystem: "apt",
      visibility: "private",
      config: validAptConfig(signingKey.id),
    });
    const token = await createToken(app, {
      name: "reader",
      repositories: ["debian-private"],
      permissions: ["read"],
      ecosystemScopes: {},
    });

    const response = await app.fetch(
      new Request("https://axis.example/repositories/debian-private/apt/key.gpg", {
        headers: { authorization: basicAuth(token) },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe(signingKey.publicKeyArmored);
  });

  it("returns apt source information using the request origin", async () => {
    const app = createApp();
    const signingKey = await createSigningKey(app);
    await createRepository(app, {
      name: "debian-public",
      ecosystem: "apt",
      visibility: "public",
      config: {
        apt: {
          codename: "noble",
          components: ["main", "contrib"],
          architectures: ["amd64"],
          signingKeyId: signingKey.id,
        },
      },
    });

    const response = await app.fetch(
      new Request("https://axis.example/repositories/debian-public/apt/source"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      repository: "debian-public",
      ecosystem: "apt",
      baseUrl: "https://axis.example/repositories/debian-public",
      codename: "noble",
      components: ["main", "contrib"],
      keyringPath: "/usr/share/keyrings/axis-debian-public.gpg",
      sourceLine:
        "deb [signed-by=/usr/share/keyrings/axis-debian-public.gpg] https://axis.example/repositories/debian-public noble main contrib",
    });
  });

  it("returns public apt install instructions", async () => {
    const app = createApp();
    const signingKey = await createSigningKey(app);
    await createRepository(app, {
      name: "debian-public",
      ecosystem: "apt",
      visibility: "public",
      config: validAptConfig(signingKey.id),
    });

    const response = await app.fetch(
      new Request("https://axis.example/repositories/debian-public/apt/install"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      repository: "debian-public",
      visibility: "public",
      keyUrl: "https://axis.example/repositories/debian-public/apt/key.gpg",
      sourceListPath: "/etc/apt/sources.list.d/axis-debian-public.list",
      commands: [
        "curl -fsSL https://axis.example/repositories/debian-public/apt/key.gpg | sudo gpg --dearmor -o /usr/share/keyrings/axis-debian-public.gpg",
        "echo 'deb [signed-by=/usr/share/keyrings/axis-debian-public.gpg] https://axis.example/repositories/debian-public noble main' | sudo tee /etc/apt/sources.list.d/axis-debian-public.list",
        "sudo apt update",
      ],
    });
  });

  it("returns private apt install auth template without requiring or exposing a token secret", async () => {
    const app = createApp();
    const signingKey = await createSigningKey(app);
    await createRepository(app, {
      name: "debian-private",
      ecosystem: "apt",
      visibility: "private",
      config: validAptConfig(signingKey.id),
    });
    const token = await createToken(app, {
      name: "reader",
      repositories: ["debian-private"],
      permissions: ["read"],
      ecosystemScopes: {},
    });

    const response = await app.fetch(
      new Request("https://axis.example/repositories/debian-private/apt/install"),
    );
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      repository: "debian-private",
      visibility: "private",
      authConfPath: "/etc/apt/auth.conf.d/axis-debian-private.conf",
      authConfTemplate: "machine axis.example\nlogin axis\npassword <READ_TOKEN>\n",
    });
    expect(JSON.stringify(body)).not.toContain(token);
  });

  it("rejects apt helper routes for non-apt repositories", async () => {
    const harness = createDevDependencyHarness();
    harness.dependencies.artifactPublisherRegistry.register({
      ecosystem: "gems",
      name: "gems-simple",
      version: "0.1.0",
      capabilities: ["serve:simple"],
      publisher: {
        publish: async () => ({ publishedAt: "2026-07-18T00:00:00.000Z", objects: [] }),
      },
      canServeRepositoryPath: ({ relativePath }) =>
        relativePath === "simple" || relativePath.startsWith("simple/"),
      validateRepositoryConfig: () => {},
      validatePublishArtifacts: () => {},
      authorizePublish: () => {},
    });
    const app = createApp(harness.dependencies);
    await createRepository(app, {
      name: "ruby-public",
      ecosystem: "gems",
      visibility: "public",
    });

    const response = await app.fetch(
      new Request("https://axis.example/repositories/ruby-public/apt/source"),
    );

    expect(response.status).toBe(404);
  });

  it("serves repository client helpers through the repository plugin namespace", async () => {
    const harness = createDevDependencyHarness();
    harness.dependencies.artifactPublisherRegistry.register({
      ecosystem: "gems",
      name: "gems-simple",
      version: "0.1.0",
      capabilities: ["client-helpers"],
      publisher: {
        publish: async () => ({ publishedAt: "2026-07-18T00:00:00.000Z", objects: [] }),
      },
      canServeRepositoryPath: () => false,
      validateRepositoryConfig: () => {},
      validatePublishArtifacts: () => {},
      authorizePublish: () => {},
      clientHelpers: {
        namespace: "simple",
        actions: [
          {
            name: "install",
            label: "Install",
            responseKind: "text",
            defaultOpen: true,
            public: true,
          },
        ],
        isPublic: () => true,
        handle: async ({ repository, action }) =>
          new Response(`${repository.ecosystem}:${repository.name}:${action}`),
      },
    });
    const app = createApp(harness.dependencies);
    await createRepository(app, {
      name: "ruby-public",
      ecosystem: "gems",
      visibility: "public",
    });

    const response = await app.fetch(
      new Request("https://axis.example/repositories/ruby-public/simple/install"),
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("gems:ruby-public:install");
  });

  it("serves the default PyPI simple URL client helper", async () => {
    const app = createApp();
    await createRepository(app, {
      name: "python-public",
      ecosystem: "pypi",
      visibility: "public",
      config: {},
    });

    const response = await app.fetch(
      new Request("https://axis.example/repositories/python-public/pypi/simple-url"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      repository: "python-public",
      ecosystem: "pypi",
      simpleUrl: "https://axis.example/repositories/python-public/simple/",
      pipIndexUrl: "https://axis.example/repositories/python-public/simple/",
    });
  });

  it("applies repository read auth to plugin client helpers that are not public", async () => {
    const harness = createDevDependencyHarness();
    harness.dependencies.artifactPublisherRegistry.register({
      ecosystem: "gems",
      name: "gems-simple",
      version: "0.1.0",
      capabilities: ["client-helpers"],
      publisher: {
        publish: async () => ({ publishedAt: "2026-07-18T00:00:00.000Z", objects: [] }),
      },
      canServeRepositoryPath: () => false,
      validateRepositoryConfig: () => {},
      validatePublishArtifacts: () => {},
      authorizePublish: () => {},
      clientHelpers: {
        namespace: "simple",
        actions: [
          {
            name: "tokened",
            label: "Tokened",
            responseKind: "text",
            defaultOpen: true,
            public: false,
          },
        ],
        isPublic: () => false,
        handle: async () => new Response("private-helper"),
      },
    });
    const app = createApp(harness.dependencies);
    await createRepository(app, {
      name: "ruby-private",
      ecosystem: "gems",
      visibility: "private",
    });
    const token = await createToken(app, {
      name: "reader",
      repositories: ["ruby-private"],
      permissions: ["read"],
      ecosystemScopes: {},
    });

    const rejected = await app.fetch(
      new Request("https://axis.example/repositories/ruby-private/simple/tokened"),
    );
    const accepted = await app.fetch(
      new Request("https://axis.example/repositories/ruby-private/simple/tokened", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );

    expect(rejected.status).toBe(401);
    expect(accepted.status).toBe(200);
    await expect(accepted.text()).resolves.toBe("private-helper");
  });

  it("serves public repository objects without a token", async () => {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    await createRepository(app, {
      name: "debian-public",
      ecosystem: "apt",
      visibility: "public",
    });
    await harness.repositoryObjectStore.putText(
      "repositories/debian-public/dists/noble/InRelease",
      "signed release",
      "text/plain; charset=utf-8",
    );

    const response = await app.fetch(
      new Request("https://axis.example/repositories/debian-public/dists/noble/InRelease"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    await expect(response.text()).resolves.toBe("signed release");
  });

  it("serves apt pool objects through the registered apt plugin", async () => {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    await createRepository(app, {
      name: "debian-public",
      ecosystem: "apt",
      visibility: "public",
    });
    await harness.repositoryObjectStore.putText(
      "repositories/debian-public/pool/main/app.deb",
      "package bytes",
      "application/vnd.debian.binary-package",
    );

    const response = await app.fetch(
      new Request("https://axis.example/repositories/debian-public/pool/main/app.deb"),
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("package bytes");
  });

  it("returns not found for apt repository paths denied by the apt plugin", async () => {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    await createRepository(app, {
      name: "debian-public",
      ecosystem: "apt",
      visibility: "public",
    });
    await harness.repositoryObjectStore.putText(
      "repositories/debian-public/secret/token.txt",
      "do not serve",
      "text/plain",
    );

    const response = await app.fetch(
      new Request("https://axis.example/repositories/debian-public/secret/token.txt"),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "not_found", message: "Not Found" },
    });
  });

  it("serves repository objects through a non-apt registered plugin", async () => {
    const harness = createDevDependencyHarness();
    harness.dependencies.artifactPublisherRegistry.register({
      ecosystem: "gems",
      name: "gems-simple",
      version: "0.1.0",
      capabilities: ["serve:simple"],
      publisher: {
        publish: async () => ({
          publishedAt: "2026-07-18T00:00:30.000Z",
          objects: [],
        }),
      },
      canServeRepositoryPath: ({ relativePath }) =>
        relativePath === "simple" || relativePath.startsWith("simple/"),
      validateRepositoryConfig: () => {},
      validatePublishArtifacts: () => {},
      authorizePublish: () => {},
    });
    const app = createApp(harness.dependencies);
    await createRepository(app, {
      name: "ruby-public",
      ecosystem: "gems",
      visibility: "public",
    });
    await harness.repositoryObjectStore.putText(
      "repositories/ruby-public/simple/example/index.html",
      "<html></html>",
      "text/html; charset=utf-8",
    );

    const response = await app.fetch(
      new Request("https://axis.example/repositories/ruby-public/simple/example/index.html"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    await expect(response.text()).resolves.toBe("<html></html>");
  });

  it("serves public repository objects with production HTTP headers", async () => {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    await createRepository(app, {
      name: "debian-public",
      ecosystem: "apt",
      visibility: "public",
    });
    await harness.repositoryObjectStore.putText(
      "repositories/debian-public/dists/noble/InRelease",
      "signed release",
      "text/plain; charset=utf-8",
    );

    const response = await app.fetch(
      new Request("https://axis.example/repositories/debian-public/dists/noble/InRelease"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("content-length")).toBe("14");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("etag")).toMatch(/^"[a-f0-9]{64}"$/);
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    await expect(response.text()).resolves.toBe("signed release");
  });

  it("serves HEAD requests for public repository objects without a body", async () => {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    await createRepository(app, {
      name: "debian-public",
      ecosystem: "apt",
      visibility: "public",
    });
    await harness.repositoryObjectStore.putText(
      "repositories/debian-public/dists/noble/InRelease",
      "signed release",
      "text/plain",
    );

    const response = await app.fetch(
      new Request("https://axis.example/repositories/debian-public/dists/noble/InRelease", {
        method: "HEAD",
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain");
    expect(response.headers.get("content-length")).toBe("14");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("etag")).toMatch(/^"[a-f0-9]{64}"$/);
    await expect(response.text()).resolves.toBe("");
  });

  it("ignores Range headers on HEAD repository object requests", async () => {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    await createRepository(app, {
      name: "debian-public",
      ecosystem: "apt",
      visibility: "public",
    });
    await harness.repositoryObjectStore.putText(
      "repositories/debian-public/dists/noble/InRelease",
      "signed release",
      "text/plain",
    );

    const response = await app.fetch(
      new Request("https://axis.example/repositories/debian-public/dists/noble/InRelease", {
        method: "HEAD",
        headers: { range: "bytes=0-0" },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-range")).toBeNull();
    expect(response.headers.get("content-length")).toBe("14");
    await expect(response.text()).resolves.toBe("");
  });

  it("serves bounded byte ranges for repository objects", async () => {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    await createRepository(app, {
      name: "debian-public",
      ecosystem: "apt",
      visibility: "public",
    });
    await harness.repositoryObjectStore.putText(
      "repositories/debian-public/pool/main/app.deb",
      "0123456789",
      "application/vnd.debian.binary-package",
    );

    const response = await app.fetch(
      new Request("https://axis.example/repositories/debian-public/pool/main/app.deb", {
        headers: { range: "bytes=2-5" },
      }),
    );

    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(response.headers.get("content-length")).toBe("4");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    await expect(response.text()).resolves.toBe("2345");
  });

  it("serves suffix byte ranges for repository objects", async () => {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    await createRepository(app, {
      name: "debian-public",
      ecosystem: "apt",
      visibility: "public",
    });
    await harness.repositoryObjectStore.putText(
      "repositories/debian-public/pool/main/app.deb",
      "0123456789",
      "application/vnd.debian.binary-package",
    );

    const response = await app.fetch(
      new Request("https://axis.example/repositories/debian-public/pool/main/app.deb", {
        headers: { range: "bytes=-4" },
      }),
    );

    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 6-9/10");
    expect(response.headers.get("content-length")).toBe("4");
    await expect(response.text()).resolves.toBe("6789");
  });

  it("serves open-ended byte ranges for repository objects", async () => {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    await createRepository(app, {
      name: "debian-public",
      ecosystem: "apt",
      visibility: "public",
    });
    await harness.repositoryObjectStore.putText(
      "repositories/debian-public/pool/main/app.deb",
      "0123456789",
      "application/vnd.debian.binary-package",
    );

    const response = await app.fetch(
      new Request("https://axis.example/repositories/debian-public/pool/main/app.deb", {
        headers: { range: "bytes=6-" },
      }),
    );

    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 6-9/10");
    expect(response.headers.get("content-length")).toBe("4");
    await expect(response.text()).resolves.toBe("6789");
  });

  it("rejects unsatisfiable and multi-range repository object requests", async () => {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    await createRepository(app, {
      name: "debian-public",
      ecosystem: "apt",
      visibility: "public",
    });
    await harness.repositoryObjectStore.putText(
      "repositories/debian-public/pool/main/app.deb",
      "0123456789",
      "application/vnd.debian.binary-package",
    );

    const unsatisfiable = await app.fetch(
      new Request("https://axis.example/repositories/debian-public/pool/main/app.deb", {
        headers: { range: "bytes=10-20" },
      }),
    );
    const multiRange = await app.fetch(
      new Request("https://axis.example/repositories/debian-public/pool/main/app.deb", {
        headers: { range: "bytes=0-1,3-4" },
      }),
    );

    expect(unsatisfiable.status).toBe(416);
    expect(unsatisfiable.headers.get("content-range")).toBe("bytes */10");
    await expect(unsatisfiable.text()).resolves.toBe("");
    expect(multiRange.status).toBe(416);
    expect(multiRange.headers.get("content-range")).toBe("bytes */10");
    await expect(multiRange.text()).resolves.toBe("");
  });

  it("rejects suffix ranges on empty repository objects", async () => {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    await createRepository(app, {
      name: "debian-public",
      ecosystem: "apt",
      visibility: "public",
    });
    await harness.repositoryObjectStore.putText(
      "repositories/debian-public/pool/main/empty.deb",
      "",
      "application/vnd.debian.binary-package",
    );

    const response = await app.fetch(
      new Request("https://axis.example/repositories/debian-public/pool/main/empty.deb", {
        headers: { range: "bytes=-1" },
      }),
    );

    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */0");
    await expect(response.text()).resolves.toBe("");
  });

  it("requires a bearer token for private repository reads", async () => {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    await createRepository(app, {
      name: "debian-private",
      ecosystem: "apt",
      visibility: "private",
    });
    await harness.repositoryObjectStore.putText(
      "repositories/debian-private/dists/noble/InRelease",
      "signed release",
      "text/plain",
    );

    const response = await app.fetch(
      new Request("https://axis.example/repositories/debian-private/dists/noble/InRelease"),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "unauthorized", message: "Unauthorized" },
    });
  });

  it("rejects private repository reads without read permission", async () => {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    await createRepository(app, {
      name: "debian-private",
      ecosystem: "apt",
      visibility: "private",
    });
    const token = await createToken(app, {
      name: "publisher",
      repositories: ["debian-private"],
      permissions: ["publish"],
      ecosystemScopes: {},
    });

    const response = await app.fetch(
      new Request("https://axis.example/repositories/debian-private/dists/noble/InRelease", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: { code: "forbidden", message: "Forbidden" },
    });
  });

  it("rejects private repository reads for tokens scoped to another repository", async () => {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    await createRepository(app, {
      name: "debian-private",
      ecosystem: "apt",
      visibility: "private",
    });
    await createRepository(app, {
      name: "other-repo",
      ecosystem: "apt",
      visibility: "private",
    });
    const token = await createToken(app, {
      name: "reader",
      repositories: ["other-repo"],
      permissions: ["read"],
      ecosystemScopes: {},
    });

    const response = await app.fetch(
      new Request("https://axis.example/repositories/debian-private/dists/noble/InRelease", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: { code: "forbidden", message: "Forbidden" },
    });
  });

  it("serves private repository objects with a read token", async () => {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    await createRepository(app, {
      name: "debian-private",
      ecosystem: "apt",
      visibility: "private",
    });
    const token = await createToken(app, {
      name: "reader",
      repositories: ["debian-private"],
      permissions: ["read"],
      ecosystemScopes: {},
    });
    await harness.repositoryObjectStore.putText(
      "repositories/debian-private/dists/noble/InRelease",
      "signed release",
      "text/plain",
    );

    const response = await app.fetch(
      new Request("https://axis.example/repositories/debian-private/dists/noble/InRelease", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain");
    await expect(response.text()).resolves.toBe("signed release");
  });

  it("serves private apt metadata and pool objects with basic read-token auth", async () => {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    await createRepository(app, {
      name: "debian-private",
      ecosystem: "apt",
      visibility: "private",
    });
    const token = await createToken(app, {
      name: "reader",
      repositories: ["debian-private"],
      permissions: ["read"],
      ecosystemScopes: {},
    });
    await harness.repositoryObjectStore.putText(
      "repositories/debian-private/dists/noble/InRelease",
      "signed release",
      "text/plain",
    );
    await harness.repositoryObjectStore.putText(
      "repositories/debian-private/dists/noble/main/binary-amd64/Packages.gz",
      "package index",
      "application/gzip",
    );
    await harness.repositoryObjectStore.putText(
      "repositories/debian-private/pool/main/app.deb",
      "package bytes",
      "application/vnd.debian.binary-package",
    );

    const inRelease = await app.fetch(
      new Request("https://axis.example/repositories/debian-private/dists/noble/InRelease", {
        headers: { authorization: basicAuth(token) },
      }),
    );
    const packages = await app.fetch(
      new Request("https://axis.example/repositories/debian-private/dists/noble/main/binary-amd64/Packages.gz", {
        headers: { authorization: basicAuth(token) },
      }),
    );
    const poolObject = await app.fetch(
      new Request("https://axis.example/repositories/debian-private/pool/main/app.deb", {
        headers: { authorization: basicAuth(token) },
      }),
    );

    expect(inRelease.status).toBe(200);
    await expect(inRelease.text()).resolves.toBe("signed release");
    expect(packages.status).toBe(200);
    expect(packages.headers.get("content-type")).toBe("application/gzip");
    await expect(packages.text()).resolves.toBe("package index");
    expect(poolObject.status).toBe(200);
    await expect(poolObject.text()).resolves.toBe("package bytes");
  });

  it("rejects malformed basic auth for private repository reads", async () => {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    await createRepository(app, {
      name: "debian-private",
      ecosystem: "apt",
      visibility: "private",
    });

    const response = await app.fetch(
      new Request("https://axis.example/repositories/debian-private/dists/noble/InRelease", {
        headers: { authorization: "Basic not-base64" },
      }),
    );

    expect(response.status).toBe(401);
  });

  it("serves private HEAD and ranged reads with read-token auth and private cache headers", async () => {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    await createRepository(app, {
      name: "debian-private",
      ecosystem: "apt",
      visibility: "private",
    });
    const token = await createToken(app, {
      name: "reader",
      repositories: ["debian-private"],
      permissions: ["read"],
      ecosystemScopes: {},
    });
    await harness.repositoryObjectStore.putText(
      "repositories/debian-private/pool/main/app.deb",
      "0123456789",
      "application/vnd.debian.binary-package",
    );

    const head = await app.fetch(
      new Request("https://axis.example/repositories/debian-private/pool/main/app.deb", {
        method: "HEAD",
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    const range = await app.fetch(
      new Request("https://axis.example/repositories/debian-private/pool/main/app.deb", {
        headers: {
          authorization: `Bearer ${token}`,
          range: "bytes=1-3",
        },
      }),
    );

    expect(head.status).toBe(200);
    expect(head.headers.get("cache-control")).toBe("private, no-store");
    expect(head.headers.get("content-length")).toBe("10");
    await expect(head.text()).resolves.toBe("");
    expect(range.status).toBe(206);
    expect(range.headers.get("cache-control")).toBe("private, no-store");
    expect(range.headers.get("content-range")).toBe("bytes 1-3/10");
    await expect(range.text()).resolves.toBe("123");
  });

  it("returns not found when a repository object does not exist", async () => {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    await createRepository(app, {
      name: "debian-public",
      ecosystem: "apt",
      visibility: "public",
    });

    const response = await app.fetch(
      new Request("https://axis.example/repositories/debian-public/dists/noble/Missing"),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "not_found", message: "Not Found" },
    });
  });

  it("rejects repository object paths with traversal segments", async () => {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    await createRepository(app, {
      name: "debian-public",
      ecosystem: "apt",
      visibility: "public",
    });
    await harness.repositoryObjectStore.putText(
      "repositories/debian-public/secret",
      "secret",
      "text/plain",
    );

    const response = await app.fetch(
      new Request("https://axis.example/repositories/debian-public/dists/%2e%2e/secret"),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "not_found", message: "Not Found" },
    });
  });

  it("creates a publish token and starts a publish session", async () => {
    const app = createApp();

    await app.fetch(
      new Request("https://axis.example/admin/repositories", {
        method: "POST",
        headers: {
          authorization: "Bearer dev-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "debian-internal", ecosystem: "apt", config: validAptConfig() }),
      }),
    );

    const tokenResponse = await app.fetch(
      new Request("https://axis.example/admin/publish-tokens", {
        method: "POST",
        headers: {
          authorization: "Bearer dev-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "github-actions",
          repositories: ["debian-internal"],
          permissions: ["publish"],
          ecosystemScopes: { apt: { allowedPackages: ["myapp"] } },
          signingKeyIds: ["signing_key_prod"],
        }),
      }),
    );

    expect(tokenResponse.status).toBe(201);
    const tokenBody = (await tokenResponse.json()) as { secret: string };
    expect(tokenBody.secret).toMatch(/^axis_publish_/);

    const sessionResponse = await app.fetch(
      new Request("https://axis.example/api/publish-sessions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${tokenBody.secret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          repositoryName: "debian-internal",
          ecosystem: "apt",
          artifacts: [
            {
              filename: "myapp_1.2.3_amd64.deb",
              size: 1234,
              sha256: "a".repeat(64),
              contentType: "application/vnd.debian.binary-package",
              metadata: {
                package: "myapp",
                version: "1.2.3",
                architecture: "amd64",
                component: "main",
                description: "Example package",
                maintainer: "Release Team <release@example.com>",
              },
            },
          ],
        }),
      }),
    );

    expect(sessionResponse.status).toBe(201);
    await expect(sessionResponse.json()).resolves.toMatchObject({
      repositoryName: "debian-internal",
      ecosystem: "apt",
      status: "pending_uploads",
      verifiedUploads: [],
      uploads: [{ filename: "myapp_1.2.3_amd64.deb", method: "PUT" }],
    });
  });

  it("starts a publish session from the publish client request shape", async () => {
    const app = createApp();
    await createRepository(app, { name: "debian-internal", ecosystem: "apt" });
    const token = await createToken(app, {
      name: "github-actions",
      repositories: ["debian-internal"],
      permissions: ["publish"],
      ecosystemScopes: { apt: { allowedPackages: ["myapp"] } },
      signingKeyIds: ["signing_key_prod"],
    });

    const sessionResponse = await app.fetch(
      new Request("https://axis.example/api/publish-sessions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          repositoryName: "debian-internal",
          ecosystem: "apt",
          artifacts: [
            {
              filename: "myapp_1.2.3_amd64.deb",
              size: 1234,
              sha256: "a".repeat(64),
              contentType: "application/vnd.debian.binary-package",
              metadata: {
                package: "myapp",
                version: "1.2.3",
                architecture: "amd64",
                component: "main",
                description: "Example package",
                maintainer: "Release Team <release@example.com>",
              },
            },
          ],
        }),
      }),
    );

    expect(sessionResponse.status).toBe(201);
    await expect(sessionResponse.json()).resolves.toMatchObject({
      repositoryName: "debian-internal",
      ecosystem: "apt",
      uploads: [{ filename: "myapp_1.2.3_amd64.deb" }],
    });
  });

  it("lists publish sessions scoped to the publish token repositories", async () => {
    const app = createApp();
    await createRepository(app, { name: "debian-internal", ecosystem: "apt" });
    await createRepository(app, { name: "debian-staging", ecosystem: "apt" });
    const internalToken = await createToken(app, {
      name: "internal-ci",
      repositories: ["debian-internal"],
      permissions: ["publish"],
      ecosystemScopes: { apt: { allowedPackages: ["myapp"] } },
      signingKeyIds: ["signing_key_prod"],
    });
    const stagingToken = await createToken(app, {
      name: "staging-ci",
      repositories: ["debian-staging"],
      permissions: ["publish"],
      ecosystemScopes: { apt: { allowedPackages: ["other"] } },
      signingKeyIds: ["signing_key_prod"],
    });

    await app.fetch(new Request("https://axis.example/api/publish-sessions", {
      method: "POST",
      headers: { authorization: `Bearer ${stagingToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        repositoryName: "debian-staging",
        ecosystem: "apt",
        artifacts: [{
          filename: "other_1.0.0_amd64.deb",
          size: 1,
          sha256: "b".repeat(64),
          contentType: "application/vnd.debian.binary-package",
          metadata: {
            package: "other",
            version: "1.0.0",
            architecture: "amd64",
            component: "main",
            description: "Other package",
            maintainer: "Release Team <release@example.com>",
          },
        }],
      }),
    }));
    const internalCreateResponse = await app.fetch(new Request("https://axis.example/api/publish-sessions", {
      method: "POST",
      headers: { authorization: `Bearer ${internalToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        repositoryName: "debian-internal",
        ecosystem: "apt",
        artifacts: [{
          filename: "myapp_1.2.3_amd64.deb",
          size: 1,
          sha256: "a".repeat(64),
          contentType: "application/vnd.debian.binary-package",
          metadata: {
            package: "myapp",
            version: "1.2.3",
            architecture: "amd64",
            component: "main",
            description: "Example package",
            maintainer: "Release Team <release@example.com>",
          },
        }],
      }),
    }));
    const internalSession = (await internalCreateResponse.json()) as { id: string };

    const listResponse = await app.fetch(
      new Request("https://axis.example/api/publish-sessions", {
        headers: { authorization: `Bearer ${internalToken}` },
      }),
    );

    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      sessions: [{ id: internalSession.id, repositoryName: "debian-internal" }],
    });
  });

  it("lists all publish sessions through the admin endpoint", async () => {
    const app = createApp();
    await createRepository(app, { name: "debian-internal", ecosystem: "apt" });
    await createRepository(app, { name: "debian-staging", ecosystem: "apt" });
    const internalToken = await createToken(app, {
      name: "internal-ci",
      repositories: ["debian-internal"],
      permissions: ["publish"],
      ecosystemScopes: { apt: { allowedPackages: ["myapp"] } },
      signingKeyIds: ["signing_key_prod"],
    });
    const stagingToken = await createToken(app, {
      name: "staging-ci",
      repositories: ["debian-staging"],
      permissions: ["publish"],
      ecosystemScopes: { apt: { allowedPackages: ["other"] } },
      signingKeyIds: ["signing_key_prod"],
    });

    const internalCreateResponse = await app.fetch(new Request("https://axis.example/api/publish-sessions", {
      method: "POST",
      headers: { authorization: `Bearer ${internalToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        repositoryName: "debian-internal",
        ecosystem: "apt",
        artifacts: [{
          filename: "myapp_1.2.3_amd64.deb",
          size: 1,
          sha256: "a".repeat(64),
          contentType: "application/vnd.debian.binary-package",
          metadata: {
            package: "myapp",
            version: "1.2.3",
            architecture: "amd64",
            component: "main",
            description: "Example package",
            maintainer: "Release Team <release@example.com>",
          },
        }],
      }),
    }));
    const stagingCreateResponse = await app.fetch(new Request("https://axis.example/api/publish-sessions", {
      method: "POST",
      headers: { authorization: `Bearer ${stagingToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        repositoryName: "debian-staging",
        ecosystem: "apt",
        artifacts: [{
          filename: "other_1.0.0_amd64.deb",
          size: 1,
          sha256: "b".repeat(64),
          contentType: "application/vnd.debian.binary-package",
          metadata: {
            package: "other",
            version: "1.0.0",
            architecture: "amd64",
            component: "main",
            description: "Other package",
            maintainer: "Release Team <release@example.com>",
          },
        }],
      }),
    }));
    const internalSession = (await internalCreateResponse.json()) as { id: string };
    const stagingSession = (await stagingCreateResponse.json()) as { id: string };

    const adminListResponse = await app.fetch(
      new Request("https://axis.example/admin/publish-sessions", {
        headers: { authorization: "Bearer dev-admin-token" },
      }),
    );
    const unauthorizedResponse = await app.fetch(new Request("https://axis.example/admin/publish-sessions"));

    expect(adminListResponse.status).toBe(200);
    const adminListBody = (await adminListResponse.json()) as { sessions: Array<{ id: string; repositoryName: string }> };
    expect(adminListBody.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: stagingSession.id, repositoryName: "debian-staging" }),
        expect.objectContaining({ id: internalSession.id, repositoryName: "debian-internal" }),
      ]),
    );
    expect(unauthorizedResponse.status).toBe(401);
  });

  it("publishes an artifact through admin-scoped publish session routes", async () => {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    const signingKey = await createSigningKey(app);
    await createRepository(app, {
      name: "debian-internal",
      ecosystem: "apt",
      config: validAptConfig(signingKey.id),
    });

    const createResponse = await app.fetch(new Request("https://axis.example/admin/publish-sessions", {
      method: "POST",
      headers: {
        authorization: "Bearer dev-admin-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        repositoryName: "debian-internal",
        ecosystem: "apt",
        artifacts: [{
          filename: "myapp_1.2.3_amd64.deb",
          size: 1234,
          sha256: "a".repeat(64),
          contentType: "application/vnd.debian.binary-package",
          metadata: {
            package: "myapp",
            version: "1.2.3",
            architecture: "amd64",
            component: "main",
            description: "Example package",
            maintainer: "Release Team <release@example.com>",
          },
        }],
      }),
    }));
    expect(createResponse.status).toBe(201);
    const session = (await createResponse.json()) as {
      id: string;
      uploads: Array<{ uploadId: string; objectKey: string }>;
    };
    const upload = session.uploads[0]!;
    await harness.repositoryObjectStore.putBytes(upload.objectKey, new Uint8Array(1234), "application/vnd.debian.binary-package");

    const verifyResponse = await app.fetch(new Request(
      `https://axis.example/admin/publish-sessions/${session.id}/uploads/${upload.uploadId}/verify`,
      {
        method: "POST",
        headers: { authorization: "Bearer dev-admin-token" },
      },
    ));
    expect(verifyResponse.status).toBe(200);

    const finalizeResponse = await app.fetch(new Request(
      `https://axis.example/admin/publish-sessions/${session.id}/finalize`,
      {
        method: "POST",
        headers: { authorization: "Bearer dev-admin-token" },
      },
    ));
    expect(finalizeResponse.status).toBe(200);
    const finalizeBody = (await finalizeResponse.json()) as {
      session: { id: string; status: string };
      result: { objects: Array<{ key: string }> };
    };
    expect(finalizeBody.session).toMatchObject({ id: session.id, status: "finalized" });
    expect(finalizeBody.result.objects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "repositories/debian-internal/pool/main/myapp/myapp_1.2.3_amd64.deb" }),
      ]),
    );
  });

  it("gets a publish session by id and rejects tokens outside the repository scope", async () => {
    const app = createApp();
    await createRepository(app, { name: "debian-internal", ecosystem: "apt" });
    const internalToken = await createToken(app, {
      name: "internal-ci",
      repositories: ["debian-internal"],
      permissions: ["publish"],
      ecosystemScopes: { apt: { allowedPackages: ["myapp"] } },
      signingKeyIds: ["signing_key_prod"],
    });
    const externalToken = await createToken(app, {
      name: "external-ci",
      repositories: ["debian-external"],
      permissions: ["publish"],
      ecosystemScopes: { apt: { allowedPackages: ["myapp"] } },
      signingKeyIds: ["signing_key_prod"],
    });
    const createResponse = await app.fetch(new Request("https://axis.example/api/publish-sessions", {
      method: "POST",
      headers: { authorization: `Bearer ${internalToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        repositoryName: "debian-internal",
        ecosystem: "apt",
        artifacts: [{
          filename: "myapp_1.2.3_amd64.deb",
          size: 1,
          sha256: "a".repeat(64),
          contentType: "application/vnd.debian.binary-package",
          metadata: {
            package: "myapp",
            version: "1.2.3",
            architecture: "amd64",
            component: "main",
            description: "Example package",
            maintainer: "Release Team <release@example.com>",
          },
        }],
      }),
    }));
    const session = (await createResponse.json()) as { id: string };

    const getResponse = await app.fetch(
      new Request(`https://axis.example/api/publish-sessions/${session.id}`, {
        headers: { authorization: `Bearer ${internalToken}` },
      }),
    );
    const forbiddenResponse = await app.fetch(
      new Request(`https://axis.example/api/publish-sessions/${session.id}`, {
        headers: { authorization: `Bearer ${externalToken}` },
      }),
    );

    expect(getResponse.status).toBe(200);
    await expect(getResponse.json()).resolves.toMatchObject({
      session: { id: session.id, repositoryName: "debian-internal" },
    });
    expect(forbiddenResponse.status).toBe(403);
  });

  it("verifies an uploaded artifact for a publish session", async () => {
    const app = createApp();

    await app.fetch(
      new Request("https://axis.example/admin/repositories", {
        method: "POST",
        headers: {
          authorization: "Bearer dev-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "debian-internal", ecosystem: "apt", config: validAptConfig() }),
      }),
    );

    const tokenResponse = await app.fetch(
      new Request("https://axis.example/admin/publish-tokens", {
        method: "POST",
        headers: {
          authorization: "Bearer dev-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "github-actions",
          repositories: ["debian-internal"],
          permissions: ["publish"],
          ecosystemScopes: { apt: { allowedPackages: ["myapp"] } },
          signingKeyIds: ["signing_key_prod"],
        }),
      }),
    );
    const tokenBody = (await tokenResponse.json()) as { secret: string };

    const sessionResponse = await app.fetch(
      new Request("https://axis.example/api/publish-sessions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${tokenBody.secret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          repositoryName: "debian-internal",
          ecosystem: "apt",
          artifacts: [
            {
              filename: "myapp_1.2.3_amd64.deb",
              size: 1234,
              sha256: "a".repeat(64),
              contentType: "application/vnd.debian.binary-package",
              metadata: {
                package: "myapp",
                version: "1.2.3",
                architecture: "amd64",
                component: "main",
                description: "Example package",
                maintainer: "Release Team <release@example.com>",
              },
            },
          ],
        }),
      }),
    );
    const session = (await sessionResponse.json()) as {
      id: string;
      uploads: Array<{ uploadId: string; objectKey: string }>;
    };

    const uploadId = session.uploads[0]?.uploadId;
    expect(uploadId).toBeTruthy();

    const verifyResponse = await app.fetch(
      new Request(
        `https://axis.example/api/publish-sessions/${session.id}/uploads/${uploadId}/verify`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${tokenBody.secret}` },
        },
      ),
    );

    expect(verifyResponse.status).toBe(200);
    await expect(verifyResponse.json()).resolves.toEqual({
      upload: {
        uploadId,
        objectKey: session.uploads[0]?.objectKey,
        size: 1234,
        sha256: "a".repeat(64),
        verifiedAt: expect.any(String),
      },
      session: expect.objectContaining({
        id: session.id,
        status: "ready",
        verifiedUploads: [
          expect.objectContaining({
            uploadId,
            sha256: "a".repeat(64),
          }),
        ],
      }),
    });
  });

  it("rejects apt publish sessions with invalid artifact metadata before creating uploads", async () => {
    const app = createApp();
    await createRepository(app, {
      name: "debian-internal",
      ecosystem: "apt",
      visibility: "private",
      config: validAptConfig(),
    });
    const token = await createToken(app, {
      name: "github-actions",
      repositories: ["debian-internal"],
      permissions: ["publish"],
      ecosystemScopes: { apt: { allowedPackages: ["myapp"] } },
      signingKeyIds: ["signing_key_prod"],
    });

    const response = await app.fetch(
      new Request("https://axis.example/api/publish-sessions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          repositoryName: "debian-internal",
          ecosystem: "apt",
          artifacts: [
            {
              filename: "myapp_1.2.3_amd64.deb",
              size: 1234,
              sha256: "a".repeat(64),
              contentType: "application/vnd.debian.binary-package",
              metadata: {
                version: "1.2.3",
                architecture: "amd64",
                component: "main",
                description: "Example package",
                maintainer: "Release Team <release@example.com>",
              },
            },
          ],
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "validation_error", message: "artifact metadata package is required" },
    });
  });

  it("rejects apt publish sessions without signing key scope before creating uploads", async () => {
    const app = createApp();
    await createRepository(app, {
      name: "debian-internal",
      ecosystem: "apt",
      visibility: "private",
      config: validAptConfig(),
    });
    const token = await createToken(app, {
      name: "github-actions",
      repositories: ["debian-internal"],
      permissions: ["publish"],
      ecosystemScopes: { apt: { allowedPackages: ["myapp"] } },
      signingKeyIds: [],
    });

    const response = await app.fetch(
      new Request("https://axis.example/api/publish-sessions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          repositoryName: "debian-internal",
          ecosystem: "apt",
          artifacts: [
            {
              filename: "myapp_1.2.3_amd64.deb",
              size: 1234,
              sha256: "a".repeat(64),
              contentType: "application/vnd.debian.binary-package",
              metadata: {
                package: "myapp",
                version: "1.2.3",
                architecture: "amd64",
                component: "main",
                description: "Example package",
                maintainer: "Release Team <release@example.com>",
              },
            },
          ],
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "validation_error",
        message: "Publish token is not scoped to the repository signing key",
      },
    });
  });

  it("finalizes a verified publish session", async () => {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    const { token, session } = await createPublishSession(app, harness.repositoryObjectStore);
    const upload = session.uploads[0]!;
    if (!upload) {
      throw new Error("Expected publish session to include an upload target");
    }

    const verifyResponse = await app.fetch(
      new Request(
        `https://axis.example/api/publish-sessions/${session.id}/uploads/${upload.uploadId}/verify`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
        },
      ),
    );
    expect(verifyResponse.status).toBe(200);

    const finalizeResponse = await app.fetch(
      new Request(`https://axis.example/api/publish-sessions/${session.id}/finalize`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      }),
    );

    expect(finalizeResponse.status).toBe(200);
    await expect(finalizeResponse.json()).resolves.toMatchObject({
      session: {
        id: session.id,
        status: "finalized",
        publishResult: {
          objects: [
            { key: "repositories/debian-internal/pool/main/myapp/myapp_1.2.3_amd64.deb" },
            { key: "repositories/debian-internal/dists/noble/main/binary-amd64/Packages" },
            { key: "repositories/debian-internal/dists/noble/main/binary-amd64/Packages.gz" },
            { key: "repositories/debian-internal/dists/noble/Release" },
            { key: "repositories/debian-internal/dists/noble/InRelease" },
            { key: "repositories/debian-internal/dists/noble/Release.gpg" },
          ],
        },
      },
    });
    expect(readStoredText(harness.repositoryObjectStore, "repositories/debian-internal/dists/noble/main/binary-amd64/Packages"))
      .toContain("Filename: pool/main/myapp/myapp_1.2.3_amd64.deb");
    expect(readStoredText(harness.repositoryObjectStore, "repositories/debian-internal/dists/noble/Release"))
      .toContain("main/binary-amd64/Packages");
    expect(readStoredText(harness.repositoryObjectStore, "repositories/debian-internal/dists/noble/InRelease"))
      .toContain("-----BEGIN PGP SIGNED MESSAGE-----");
    expect(readStoredText(harness.repositoryObjectStore, "repositories/debian-internal/dists/noble/Release.gpg"))
      .toContain("-----BEGIN PGP SIGNATURE-----");
  });

  it("fails closed when finalizing APT without matching signing key scope", async () => {
    const { generateKey } = await import("openpgp");
    const key = await generateKey({
      type: "ecc",
      curve: "curve25519Legacy",
      userIDs: [{ name: "Axis Test", email: "axis@example.test" }],
      passphrase: "correct-passphrase",
    });
    const app = createApp();

    const signingKeyResponse = await app.fetch(
      new Request("https://axis.example/admin/repositories/debian-prod/apt/signing-keys/import", {
        method: "POST",
        headers: {
          authorization: "Bearer dev-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "debian-prod",
          privateKeyArmored: key.privateKey,
          passphrase: "correct-passphrase",
        }),
      }),
    );
    const signingKey = (await signingKeyResponse.json()) as { id: string };

    await app.fetch(
      new Request("https://axis.example/admin/repositories", {
        method: "POST",
        headers: {
          authorization: "Bearer dev-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "debian-internal",
          ecosystem: "apt",
          config: {
            apt: {
              codename: "noble",
              components: ["main"],
              architectures: ["amd64"],
              signingKeyId: signingKey.id,
            },
          },
        }),
      }),
    );

    const tokenResponse = await app.fetch(
      new Request("https://axis.example/admin/publish-tokens", {
        method: "POST",
        headers: {
          authorization: "Bearer dev-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "github-actions",
          repositories: ["debian-internal"],
          permissions: ["publish"],
          ecosystemScopes: {},
          signingKeyIds: [],
        }),
      }),
    );
    const tokenBody = (await tokenResponse.json()) as { secret: string };

    const sessionResponse = await app.fetch(
      new Request("https://axis.example/api/publish-sessions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${tokenBody.secret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          repositoryName: "debian-internal",
          ecosystem: "apt",
          artifacts: [
            {
              filename: "myapp_1.2.3_amd64.deb",
              size: 1234,
              sha256: "a".repeat(64),
              contentType: "application/vnd.debian.binary-package",
              metadata: {
                package: "myapp",
                version: "1.2.3",
                architecture: "amd64",
                component: "main",
                description: "Example package",
                maintainer: "Release Team <release@example.com>",
              },
            },
          ],
        }),
      }),
    );
    expect(sessionResponse.status).toBe(400);
    await expect(sessionResponse.json()).resolves.toEqual({
      error: {
        code: "validation_error",
        message: "Publish token is not scoped to the repository signing key",
      },
    });
    return;

    const session = (await sessionResponse.json()) as {
      id: string;
      uploads: Array<{ uploadId: string }>;
    };
    const upload = session.uploads[0]!;

    const verifyResponse = await app.fetch(
      new Request(
        `https://axis.example/api/publish-sessions/${session.id}/uploads/${upload.uploadId}/verify`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${tokenBody.secret}` },
        },
      ),
    );
    expect(verifyResponse.status).toBe(200);

    const finalizeResponse = await app.fetch(
      new Request(`https://axis.example/api/publish-sessions/${session.id}/finalize`, {
        method: "POST",
        headers: { authorization: `Bearer ${tokenBody.secret}` },
      }),
    );

    expect(finalizeResponse.status).toBe(400);
    await expect(finalizeResponse.json()).resolves.toEqual({
      error: {
        code: "validation_error",
        message: "Publish token is not scoped to the repository signing key",
      },
    });
  });

  it("fails closed before publishing a repository with no registered plugin", async () => {
    const app = createApp();

    const createRepository = await app.fetch(
      new Request("https://axis.example/admin/repositories", {
        method: "POST",
        headers: {
          authorization: "Bearer dev-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "node-internal", ecosystem: "npm" }),
      }),
    );
    expect(createRepository.status).toBe(400);
    await expect(createRepository.json()).resolves.toEqual({
      error: {
        code: "validation_error",
        message: "Artifact repository plugin is not configured for ecosystem: npm",
      },
    });
  });

  it("rejects finalizing before uploads are verified", async () => {
    const app = createApp();
    const { token, session } = await createPublishSession(app);

    const response = await app.fetch(
      new Request(`https://axis.example/api/publish-sessions/${session.id}/finalize`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "validation_error" },
    });
  });

  it("rejects finalizing without a bearer token", async () => {
    const app = createApp();
    const { session } = await createPublishSession(app);

    const response = await app.fetch(
      new Request(`https://axis.example/api/publish-sessions/${session.id}/finalize`, {
        method: "POST",
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "unauthorized", message: "Unauthorized" },
    });
  });

  it("does not expose publish token hashes when listing publish tokens", async () => {
    const app = createApp();

    const createResponse = await app.fetch(
      new Request("https://axis.example/admin/publish-tokens", {
        method: "POST",
        headers: {
          authorization: "Bearer dev-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "github-actions",
          repositories: ["debian-internal"],
          permissions: ["publish"],
          ecosystemScopes: {},
        }),
      }),
    );

    expect(createResponse.status).toBe(201);
    const createBody = (await createResponse.json()) as { token: Record<string, unknown> };
    expect(createBody.token).not.toHaveProperty("tokenHash");

    const listResponse = await app.fetch(
      new Request("https://axis.example/admin/publish-tokens", {
        headers: { authorization: "Bearer dev-admin-token" },
      }),
    );

    expect(listResponse.status).toBe(200);
    const listBody = (await listResponse.json()) as { publishTokens: Array<Record<string, unknown>> };
    expect(listBody.publishTokens).toHaveLength(1);
    expect(listBody.publishTokens[0]).not.toHaveProperty("tokenHash");
  });

  it("gets publish tokens by name without exposing secrets or hashes", async () => {
    const app = createApp();
    const secret = await createToken(app, {
      name: "github-actions",
      repositories: ["debian-internal"],
      permissions: ["publish"],
      ecosystemScopes: {},
    });

    const response = await app.fetch(
      new Request("https://axis.example/admin/publish-tokens/github-actions", {
        headers: { authorization: "Bearer dev-admin-token" },
      }),
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      name: "github-actions",
      repositories: ["debian-internal"],
      permissions: ["publish"],
    });
    expect(body).not.toHaveProperty("tokenHash");
    expect(JSON.stringify(body)).not.toContain(secret);
  });

  it("revokes publish tokens by name without exposing secrets or hashes", async () => {
    const app = createApp();
    const secret = await createToken(app, {
      name: "github-actions",
      repositories: ["debian-internal"],
      permissions: ["publish"],
      ecosystemScopes: {},
    });

    const response = await app.fetch(
      new Request("https://axis.example/admin/publish-tokens/github-actions/revoke", {
        method: "POST",
        headers: { authorization: "Bearer dev-admin-token" },
      }),
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      name: "github-actions",
      revokedAt: expect.any(String),
    });
    expect(body).not.toHaveProperty("tokenHash");
    expect(JSON.stringify(body)).not.toContain(secret);
  });

  it("revokes publish tokens idempotently through admin routes", async () => {
    const app = createApp();
    await createToken(app, {
      name: "github-actions",
      repositories: ["debian-internal"],
      permissions: ["publish"],
      ecosystemScopes: {},
    });

    const first = await app.fetch(
      new Request("https://axis.example/admin/publish-tokens/github-actions/revoke", {
        method: "POST",
        headers: { authorization: "Bearer dev-admin-token" },
      }),
    );
    const firstBody = (await first.json()) as { revokedAt: string };
    const second = await app.fetch(
      new Request("https://axis.example/admin/publish-tokens/github-actions/revoke", {
        method: "POST",
        headers: { authorization: "Bearer dev-admin-token" },
      }),
    );
    const secondBody = (await second.json()) as { revokedAt: string };

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(secondBody.revokedAt).toBe(firstBody.revokedAt);
  });

  it("returns not found for missing publish token admin resources", async () => {
    const app = createApp();

    const detail = await app.fetch(
      new Request("https://axis.example/admin/publish-tokens/missing", {
        headers: { authorization: "Bearer dev-admin-token" },
      }),
    );
    const revoke = await app.fetch(
      new Request("https://axis.example/admin/publish-tokens/missing/revoke", {
        method: "POST",
        headers: { authorization: "Bearer dev-admin-token" },
      }),
    );

    expect(detail.status).toBe(404);
    expect(revoke.status).toBe(404);
  });

  it("creates a publish token with an expiration", async () => {
    const app = createApp();
    const expiresAt = "2030-01-01T00:00:00.000Z";

    const response = await app.fetch(
      new Request("https://axis.example/admin/publish-tokens", {
        method: "POST",
        headers: {
          authorization: "Bearer dev-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "github-actions",
          repositories: ["debian-internal"],
          permissions: ["publish"],
          ecosystemScopes: {},
          expiresAt,
        }),
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      token: { expiresAt },
    });
  });

  it("creates a publish token with signing key scopes", async () => {
    const app = createApp();

    const response = await app.fetch(
      new Request("https://axis.example/admin/publish-tokens", {
        method: "POST",
        headers: {
          authorization: "Bearer dev-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "github-actions",
          repositories: ["debian-internal"],
          permissions: ["publish"],
          ecosystemScopes: {},
          signingKeyIds: ["signing_key_prod"],
        }),
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      token: { signingKeyIds: ["signing_key_prod"] },
    });
  });

  it("imports, generates, lists, and revokes APT signing keys through admin routes", async () => {
    const { generateKey } = await import("openpgp");
    const key = await generateKey({
      type: "ecc",
      curve: "curve25519Legacy",
      userIDs: [{ name: "Axis Test", email: "axis@example.test" }],
      passphrase: "correct-passphrase",
    });
    const app = createApp();

    const createResponse = await app.fetch(
      new Request("https://axis.example/admin/repositories/debian-prod/apt/signing-keys/import", {
        method: "POST",
        headers: {
          authorization: "Bearer dev-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "debian-prod",
          privateKeyArmored: key.privateKey,
          passphrase: "correct-passphrase",
        }),
      }),
    );

    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as {
      id: string;
      privateKeyArmored?: string;
      passphrase?: string;
    };
    expect(created.id).toMatch(/^signing_key_/);
    expect(created).toMatchObject({ repositoryName: "debian-prod" });
    expect(created).not.toHaveProperty("privateKeyArmored");
    expect(created).not.toHaveProperty("passphrase");
    expect(created).not.toHaveProperty("encryptedPrivateKeyArmored");
    expect(created).not.toHaveProperty("encryptedPassphrase");

    const listResponse = await app.fetch(
      new Request("https://axis.example/admin/repositories/debian-prod/apt/signing-keys", {
        headers: { authorization: "Bearer dev-admin-token" },
      }),
    );
    expect(listResponse.status).toBe(200);
    const listBody = (await listResponse.json()) as { signingKeys: Array<Record<string, unknown>> };
    expect(listBody).toMatchObject({
      signingKeys: [{ name: "debian-prod", revokedAt: null }],
    });
    expect(listBody.signingKeys[0]).not.toHaveProperty("privateKeyArmored");
    expect(listBody.signingKeys[0]).not.toHaveProperty("passphrase");
    expect(listBody.signingKeys[0]).not.toHaveProperty("encryptedPrivateKeyArmored");
    expect(listBody.signingKeys[0]).not.toHaveProperty("encryptedPassphrase");

    const detailResponse = await app.fetch(
      new Request(`https://axis.example/admin/repositories/debian-prod/apt/signing-keys/${created.id}`, {
        headers: { authorization: "Bearer dev-admin-token" },
      }),
    );
    expect(detailResponse.status).toBe(200);
    const detail = (await detailResponse.json()) as Record<string, unknown>;
    expect(detail).toMatchObject({
      id: created.id,
      name: "debian-prod",
      revokedAt: null,
    });
    expect(detail).not.toHaveProperty("privateKeyArmored");
    expect(detail).not.toHaveProperty("passphrase");
    expect(detail).not.toHaveProperty("encryptedPrivateKeyArmored");
    expect(detail).not.toHaveProperty("encryptedPassphrase");

    const revokeResponse = await app.fetch(
      new Request(`https://axis.example/admin/repositories/debian-prod/apt/signing-keys/${created.id}/revoke`, {
        method: "POST",
        headers: { authorization: "Bearer dev-admin-token" },
      }),
    );
    expect(revokeResponse.status).toBe(200);
    const revoked = (await revokeResponse.json()) as Record<string, unknown>;
    expect(revoked).toMatchObject({
      id: created.id,
      revokedAt: expect.any(String),
    });
    expect(revoked).not.toHaveProperty("privateKeyArmored");
    expect(revoked).not.toHaveProperty("passphrase");
    expect(revoked).not.toHaveProperty("encryptedPrivateKeyArmored");
    expect(revoked).not.toHaveProperty("encryptedPassphrase");

    const generateResponse = await app.fetch(
      new Request("https://axis.example/admin/repositories/debian-prod/apt/signing-keys/generate", {
        method: "POST",
        headers: {
          authorization: "Bearer dev-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "debian-generated",
          userIdName: "Axis Repository",
          userIdEmail: "axis@example.test",
        }),
      }),
    );
    expect(generateResponse.status).toBe(201);
    const generated = (await generateResponse.json()) as Record<string, unknown>;
    expect(generated).toMatchObject({
      name: "debian-generated",
      repositoryName: "debian-prod",
      revokedAt: null,
    });
    expect(generated).not.toHaveProperty("privateKeyArmored");
    expect(generated).not.toHaveProperty("passphrase");
  });

  it("returns not found for missing APT signing key admin detail", async () => {
    const app = createApp();

    const response = await app.fetch(
      new Request("https://axis.example/admin/repositories/debian-prod/apt/signing-keys/signing_key_missing", {
        headers: { authorization: "Bearer dev-admin-token" },
      }),
    );

    expect(response.status).toBe(404);
  });

  it("requires admin auth for APT signing key revoke paths before method dispatch", async () => {
    const app = createApp();

    const response = await app.fetch(
      new Request("https://axis.example/admin/repositories/debian-prod/apt/signing-keys/signing_key_missing/revoke"),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "unauthorized", message: "Unauthorized" },
    });
  });

  it("creates a publish token with an explicit empty signing key scope", async () => {
    const app = createApp();

    const response = await app.fetch(
      new Request("https://axis.example/admin/publish-tokens", {
        method: "POST",
        headers: {
          authorization: "Bearer dev-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "github-actions",
          repositories: ["debian-internal"],
          permissions: ["publish"],
          ecosystemScopes: {},
          signingKeyIds: [],
        }),
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      token: { signingKeyIds: [] },
    });
  });

  it("rejects publish token signing key scopes with non-string values", async () => {
    const app = createApp();

    const response = await app.fetch(
      new Request("https://axis.example/admin/publish-tokens", {
        method: "POST",
        headers: {
          authorization: "Bearer dev-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "github-actions",
          repositories: ["debian-internal"],
          permissions: ["publish"],
          ecosystemScopes: {},
          signingKeyIds: ["signing_key_prod", 123],
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "validation_error", message: "signingKeyIds must be an array of strings" },
    });
  });

  it("rejects invalid publish token expirations", async () => {
    const app = createApp();

    const response = await app.fetch(
      new Request("https://axis.example/admin/publish-tokens", {
        method: "POST",
        headers: {
          authorization: "Bearer dev-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "github-actions",
          repositories: ["debian-internal"],
          permissions: ["publish"],
          ecosystemScopes: {},
          expiresAt: "not-a-date",
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "validation_error", message: "Publish token expiresAt must be a valid date" },
    });
  });

  it("rejects malformed publish session artifacts", async () => {
    const app = createApp();

    await app.fetch(
      new Request("https://axis.example/admin/repositories", {
        method: "POST",
        headers: {
          authorization: "Bearer dev-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "debian-internal", ecosystem: "apt", config: validAptConfig() }),
      }),
    );

    const tokenResponse = await app.fetch(
      new Request("https://axis.example/admin/publish-tokens", {
        method: "POST",
        headers: {
          authorization: "Bearer dev-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "github-actions",
          repositories: ["debian-internal"],
          permissions: ["publish"],
          ecosystemScopes: { apt: { allowedPackages: ["myapp"] } },
        }),
      }),
    );
    const tokenBody = (await tokenResponse.json()) as { secret: string };

    const response = await app.fetch(
      new Request("https://axis.example/api/publish-sessions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${tokenBody.secret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          repositoryName: "debian-internal",
          ecosystem: "apt",
          artifacts: [{}],
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "validation_error", message: "artifacts[0].filename is required" },
    });
  });

  it("rejects publish session artifacts with invalid sha256 digests", async () => {
    const app = createApp();

    await app.fetch(
      new Request("https://axis.example/admin/repositories", {
        method: "POST",
        headers: {
          authorization: "Bearer dev-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "debian-internal", ecosystem: "apt", config: validAptConfig() }),
      }),
    );

    const tokenResponse = await app.fetch(
      new Request("https://axis.example/admin/publish-tokens", {
        method: "POST",
        headers: {
          authorization: "Bearer dev-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "github-actions",
          repositories: ["debian-internal"],
          permissions: ["publish"],
          ecosystemScopes: { apt: { allowedPackages: ["myapp"] } },
        }),
      }),
    );
    const tokenBody = (await tokenResponse.json()) as { secret: string };

    const response = await app.fetch(
      new Request("https://axis.example/api/publish-sessions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${tokenBody.secret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          repositoryName: "debian-internal",
          ecosystem: "apt",
          artifacts: [
            {
              filename: "myapp_1.2.3_amd64.deb",
              size: 1234,
              sha256: "not-a-digest",
              contentType: "application/vnd.debian.binary-package",
              metadata: {},
            },
          ],
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "validation_error", message: "artifacts[0].sha256 must be a 64-character hex digest" },
    });
  });
});
