import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { RepositoryRuntimePluginRegistry } from "../plugins/repository-runtime-plugin-registry";
import { createDevDependencies, createDevDependencyHarness } from "./dev-dependencies";
import { debArchive } from "@axis-repository/plugin-apt/test-support";
import { sdistBytes, wheelBytes } from "@axis-repository/plugin-pypi/test-support";
import type { MemoryRepositoryObjectStore } from "../storage/repository-object-store";

afterEach(() => {
  vi.doUnmock("./app");
  vi.resetModules();
});

function aptDebFixture(input: {
  packageName?: string;
  version?: string;
  architecture?: string;
  component?: string;
} = {}): Uint8Array {
  return debArchive({
    control: [
      `Package: ${input.packageName ?? "myapp"}`,
      `Version: ${input.version ?? "1.2.3"}`,
      `Architecture: ${input.architecture ?? "amd64"}`,
      "Maintainer: Release Team <release@example.com>",
      "Description: Example package",
      `Section: ${input.component ?? "main"}`,
    ].join("\n"),
  });
}

async function createPublishSession(
  app: ReturnType<typeof createApp>,
  repositoryObjectStore?: MemoryRepositoryObjectStore,
) {
  const debBytes = aptDebFixture();
  const debSha256 = await sha256Hex(debBytes);
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
            size: debBytes.byteLength,
            sha256: debSha256,
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
        debBytes,
        "application/vnd.debian.binary-package",
      );
    }
  }

  return { token: tokenBody.secret, session };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
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
    const app = createApp(createDevDependencies());
    const response = await app.fetch(new Request("https://axis.example/health"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, service: "axis-repository" });
  });

  it("returns not found for unknown API routes", async () => {
    const app = createApp(createDevDependencies());
    const response = await app.fetch(new Request("https://axis.example/api/missing"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "not_found", message: "Not Found" },
    });
  });

  it("redirects root requests to the admin UI namespace", async () => {
    const app = createApp(createDevDependencies());
    const response = await app.fetch(new Request("https://axis.example/"));

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/ui/");
  });

  it("redirects bare admin UI namespace requests to the canonical trailing slash", async () => {
    const app = createApp(createDevDependencies());
    const response = await app.fetch(new Request("https://axis.example/ui"));

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/ui/");
  });

  it("serves the admin UI shell under the /ui namespace", async () => {
    const app = createApp(createDevDependencies());
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
    const app = createApp(createDevDependencies());

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

  it("declares theme-specific admin UI favicons", async () => {
    const app = createApp(createDevDependencies());

    const shell = await app.fetch(new Request("https://axis.example/ui/"));
    const shellHtml = await shell.text();

    expect(shellHtml).toContain('<link rel="icon" type="image/svg+xml" href="/logo-mark-light.svg" media="(prefers-color-scheme: light)" />');
    expect(shellHtml).toContain('<link rel="icon" type="image/svg+xml" href="/logo-mark-dark.svg" media="(prefers-color-scheme: dark)" />');
    expect(shellHtml).not.toContain('href="/favicon.svg"');
  });

  it("serves the admin UI favicon at the browser default root path", async () => {
    const app = createApp(createDevDependencies());
    const response = await app.fetch(new Request("https://axis.example/favicon.svg"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    await expect(response.text()).resolves.toContain("<svg");
  });

  it("serves theme-specific logo mark assets", async () => {
    const app = createApp(createDevDependencies());

    for (const path of ["/logo-mark-light.svg", "/logo-mark-dark.svg"]) {
      const response = await app.fetch(new Request(`https://axis.example${path}`));

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/svg+xml");
      const body = await response.text();
      expect(body).toContain("<svg");
      expect(body).not.toContain("<!DOCTYPE html>");
    }
  });

  it("does not serve the admin UI shell for reserved namespace roots", async () => {
    const app = createApp(createDevDependencies());

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
    const app = createApp(createDevDependencies());

    const response = await app.fetch(new Request("https://axis.example/login"));

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
  });

  it("creates and lists repositories through admin routes", async () => {
    const app = createApp(createDevDependencies());

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

  it("deletes repositories, repository objects, and affected publish token scopes", async () => {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    await createRepository(app, {
      name: "python-internal",
      ecosystem: "pypi",
      visibility: "private",
      config: {},
    });
    await createRepository(app, {
      name: "python-shared",
      ecosystem: "pypi",
      visibility: "private",
      config: {},
    });
    await harness.repositoryObjectStore.putText(
      "repositories/python-internal/simple/demo/index.html",
      "demo",
      "text/html",
    );
    await harness.repositoryObjectStore.putText(
      "repositories/python-shared/simple/other/index.html",
      "other",
      "text/html",
    );
    await createToken(app, {
      name: "multi-token",
      repositories: ["python-internal", "python-shared"],
      permissions: ["publish"],
      ecosystemScopes: {},
    });
    await createToken(app, {
      name: "single-token",
      repositories: ["python-internal"],
      permissions: ["publish"],
      ecosystemScopes: {},
    });

    const deleteResponse = await app.fetch(
      new Request("https://axis.example/admin/repositories/python-internal", {
        method: "DELETE",
        headers: { authorization: "Bearer dev-admin-token" },
      }),
    );

    expect(deleteResponse.status).toBe(204);
    await expect(harness.repositoryObjectStore.headObject("repositories/python-internal/simple/demo/index.html")).resolves.toBeNull();
    await expect(harness.repositoryObjectStore.headObject("repositories/python-shared/simple/other/index.html")).resolves.not.toBeNull();
    const repositoriesResponse = await app.fetch(
      new Request("https://axis.example/admin/repositories", {
        headers: { authorization: "Bearer dev-admin-token" },
      }),
    );
    await expect(repositoriesResponse.json()).resolves.toMatchObject({
      repositories: [{ name: "python-shared" }],
    });
    const tokensResponse = await app.fetch(
      new Request("https://axis.example/admin/publish-tokens", {
        headers: { authorization: "Bearer dev-admin-token" },
      }),
    );
    const tokensBody = await tokensResponse.json() as {
      publishTokens: Array<{ name: string; repositories: string[]; revokedAt?: string }>;
    };
    expect(tokensBody.publishTokens).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "multi-token", repositories: ["python-shared"] }),
      expect.objectContaining({ name: "single-token", repositories: [], revokedAt: expect.any(String) }),
    ]));
  });

  it("empties a repository a page at a time rather than an object at a time", async () => {
    // One round trip each and the caller waits for all of them, which on a
    // repository of a few thousand objects is minutes of it.
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    await createRepository(app, {
      name: "python-internal",
      ecosystem: "pypi",
      visibility: "private",
      config: {},
    });
    for (const name of ["a", "b", "c"]) {
      await harness.repositoryObjectStore.putText(
        `repositories/python-internal/simple/${name}/index.html`,
        name,
        "text/html",
      );
    }
    const store = harness.repositoryObjectStore;
    const deleteObjects = store.deleteObjects.bind(store);
    let batches = 0;
    let singles = 0;
    store.deleteObjects = async (keys) => {
      batches += 1;
      await deleteObjects(keys);
    };
    store.deleteObject = async () => {
      singles += 1;
      return false;
    };

    const response = await app.fetch(
      new Request("https://axis.example/admin/repositories/python-internal", {
        method: "DELETE",
        headers: { authorization: "Bearer dev-admin-token" },
      }),
    );

    expect(response.status).toBe(204);
    expect(batches).toBe(1);
    expect(singles).toBe(0);
    expect(store.objects).toHaveLength(0);
  });

  it("gives up emptying a repository when a round removes nothing", async () => {
    // Each round lists from the start, so a page naming the same object as the
    // one before it is a page nothing removed. Asking again would ask forever,
    // and a durable object's wall clock does not stop it.
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    await createRepository(app, {
      name: "python-internal",
      ecosystem: "pypi",
      visibility: "private",
      config: {},
    });
    await harness.repositoryObjectStore.putText(
      "repositories/python-internal/simple/demo/index.html",
      "demo",
      "text/html",
    );
    const store = harness.repositoryObjectStore;
    const listObjects = store.listObjects.bind(store);
    let lists = 0;
    store.listObjects = async (input) => {
      lists += 1;
      if (lists > 8) {
        throw new Error("listed the same objects over and over");
      }
      // Truncated, so the loop is invited back, and nothing is ever removed.
      return { ...await listObjects(input), truncated: true };
    };
    store.deleteObjects = async () => {};

    const response = await app.fetch(
      new Request("https://axis.example/admin/repositories/python-internal", {
        method: "DELETE",
        headers: { authorization: "Bearer dev-admin-token" },
      }),
    );

    expect(response.status).toBe(204);
    expect(lists).toBe(2);
  });

  it("rejects admin repository routes without an access token", async () => {
    const app = createApp(createDevDependencies());
    const response = await app.fetch(new Request("https://axis.example/admin/repositories"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "unauthorized", message: "Unauthorized" },
    });
  });

  it("verifies valid admin access tokens through the admin session route", async () => {
    const app = createApp(createDevDependencies());
    const response = await app.fetch(
      new Request("https://axis.example/admin/session", {
        headers: { authorization: "Bearer dev-admin-token" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      principal: {
        type: "admin",
        subject: "admin_user_dev",
        username: "admin",
        role: "owner",
        scopes: ["admin:*"],
        sessionId: "admin_session_dev",
      },
    });
  });

  it("logs in, refreshes, and logs out admin sessions", async () => {
    const app = createApp(createDevDependencies());
    const loginResponse = await app.fetch(new Request("https://axis.example/admin/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin-local-password" }),
    }));
    expect(loginResponse.status).toBe(200);
    expect(loginResponse.headers.get("set-cookie")).toContain("axis_admin_refresh=");
    const loginCookie = loginResponse.headers.get("set-cookie") ?? "";
    const loginBody = await loginResponse.json() as {
      accessToken: string;
      principal: { subject: string; username: string; role: string };
    };
    expect(loginBody.principal).toMatchObject({
      subject: "admin_user_dev",
      username: "admin",
      role: "owner",
    });

    const refreshResponse = await app.fetch(new Request("https://axis.example/admin/auth/refresh", {
      method: "POST",
      headers: { cookie: loginCookie },
    }));
    expect(refreshResponse.status).toBe(200);
    expect(refreshResponse.headers.get("set-cookie")).toContain("axis_admin_refresh=");
    const refreshBody = await refreshResponse.json() as { accessToken: string };
    expect(refreshBody.accessToken).toBe("dev-admin-token");

    const staleRefreshResponse = await app.fetch(new Request("https://axis.example/admin/auth/refresh", {
      method: "POST",
      headers: { cookie: loginCookie },
    }));
    expect(staleRefreshResponse.status).toBe(401);

    const logoutResponse = await app.fetch(new Request("https://axis.example/admin/auth/logout", {
      method: "POST",
      headers: { cookie: refreshResponse.headers.get("set-cookie") ?? "" },
    }));
    expect(logoutResponse.status).toBe(204);
    expect(logoutResponse.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("clears the refresh cookie even when the session is already gone", async () => {
    const app = createApp(createDevDependencies());
    const loginResponse = await app.fetch(new Request("https://axis.example/admin/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin-local-password" }),
    }));
    const cookie = loginResponse.headers.get("set-cookie") ?? "";

    const first = await app.fetch(new Request("https://axis.example/admin/auth/logout", {
      method: "POST",
      headers: { cookie },
    }));
    const second = await app.fetch(new Request("https://axis.example/admin/auth/logout", {
      method: "POST",
      headers: { cookie },
    }));

    // A second logout must still clear, or the browser keeps presenting a dead
    // token forever.
    expect(first.status).toBe(204);
    expect(second.status).toBe(204);
    expect(second.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("changes the current admin password and clears the refresh cookie", async () => {
    const app = createApp(createDevDependencies());
    const loginResponse = await app.fetch(new Request("https://axis.example/admin/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin-local-password" }),
    }));
    const loginCookie = loginResponse.headers.get("set-cookie") ?? "";
    const loginBody = await loginResponse.json() as { accessToken: string };

    const changeResponse = await app.fetch(new Request("https://axis.example/admin/auth/change-password", {
      method: "POST",
      headers: {
        authorization: `Bearer ${loginBody.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        currentPassword: "admin-local-password",
        newPassword: "changed-password",
      }),
    }));

    expect(changeResponse.status).toBe(204);
    expect(changeResponse.headers.get("set-cookie")).toContain("Max-Age=0");
    const staleRefreshResponse = await app.fetch(new Request("https://axis.example/admin/auth/refresh", {
      method: "POST",
      headers: { cookie: loginCookie },
    }));
    expect(staleRefreshResponse.status).toBe(401);

    const oldLoginResponse = await app.fetch(new Request("https://axis.example/admin/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin-local-password" }),
    }));
    expect(oldLoginResponse.status).toBe(401);

    const newLoginResponse = await app.fetch(new Request("https://axis.example/admin/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "changed-password" }),
    }));
    expect(newLoginResponse.status).toBe(200);
  });

  it("lists seeded admin users and keeps user creation coming soon", async () => {
    const app = createApp(createDevDependencies());
    // The owner is seeded on sign-in, which is the only way an access
    // token can exist in production.
    await app.fetch(new Request("https://axis.example/admin/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin-local-password" }),
    }));
    await app.fetch(new Request("https://axis.example/admin/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin-local-password" }),
    }));

    const listResponse = await app.fetch(new Request("https://axis.example/admin/users", {
      headers: { authorization: "Bearer dev-admin-token" },
    }));
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual({
      canCreateUsers: false,
      users: [
        expect.objectContaining({
          id: "admin_user_dev",
          username: "admin",
          displayName: "admin",
          role: "owner",
        }),
      ],
    });

    const createResponse = await app.fetch(new Request("https://axis.example/admin/users", {
      method: "POST",
      headers: {
        authorization: "Bearer dev-admin-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ username: "other" }),
    }));
    expect(createResponse.status).toBe(501);
    await expect(createResponse.json()).resolves.toEqual({
      error: { code: "not_implemented", message: "Admin user creation is coming soon" },
    });
  });

  it("reports the bootstrap credentials the deployment no longer needs", async () => {
    const app = createApp(createDevDependencies());
    // Signing in is what creates the account, and so what makes the values
    // that seeded it redundant.
    await app.fetch(new Request("https://axis.example/admin/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin-local-password" }),
    }));

    const response = await app.fetch(new Request("https://axis.example/admin/deployment", {
      headers: { authorization: "Bearer dev-admin-token" },
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      leftoverBootstrapCredentials: [
        expect.objectContaining({ name: "AXIS_ADMIN_PASSWORD", sensitive: true }),
        expect.objectContaining({ name: "AXIS_ADMIN_USERNAME", sensitive: false }),
      ],
    });
  });

  it("does not tell an unauthenticated caller what this deployment still holds", async () => {
    const app = createApp(createDevDependencies());

    const response = await app.fetch(new Request("https://axis.example/admin/deployment"));

    expect(response.status).toBe(401);
  });

  it("says so in its own log, for an operator who never opens the admin UI", async () => {
    const warnings: unknown[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation((...args) => void warnings.push(args[0]));
    const app = createApp(createDevDependencies());

    // The first sign-in creates the account; the second finds it already there.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await app.fetch(new Request("https://axis.example/admin/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "admin-local-password" }),
      }));
    }
    warn.mockRestore();

    expect(warnings.join("\n")).toContain("AXIS_ADMIN_PASSWORD");
  });

  it("rejects invalid admin access tokens through the admin session route", async () => {
    const app = createApp(createDevDependencies());
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
    const app = createApp(createDevDependencies());
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
    const app = createApp(createDevDependencies());
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
    const app = createApp(createDevDependencies());

    const response = await app.fetch(
      new Request("https://axis.example/admin/repository-plugins", {
        headers: { authorization: "Bearer dev-admin-token" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      plugins: [
        expect.objectContaining({
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
          icon: expect.objectContaining({
            title: "APT",
            accentColor: "#A80030",
            inlineSvg: expect.stringContaining("<svg"),
          }),
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
        }),
        expect.objectContaining({
          ecosystem: "pypi",
          name: "pypi-simple",
          version: "0.1.0",
          enabled: true,
          catalogEnabled: true,
          enabledOverride: null,
          experimental: false,
          runtime: true,
          adminUi: true,
          capabilities: ["pypi", "simple-api", "serve:simple", "client-helpers"],
          icon: expect.objectContaining({
            title: "PyPI",
            accentColor: "#3775A9",
            inlineSvg: expect.stringContaining("<svg"),
          }),
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
              {
                name: "twine-config",
                label: "twine upload",
                responseKind: "text",
                defaultOpen: false,
                public: false,
                displayPath: "pypirc",
              },
            ],
          },
        }),
      ],
    });
  });

  it("updates repository plugin policy overrides through admin routes", async () => {
    const app = createApp(createDevDependencies());

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
    harness.dependencies.repositoryRuntimePlugins.register({
      ecosystem: "demo",
      name: "demo-plugin",
      version: "0.1.0",
      capabilities: ["admin-resources"],
      canServeRepositoryPath: () => false,
      validateRepositoryConfig: () => {},
      publish: {
        validateArtifacts: () => {},
        authorize: () => {},
        finalize: async () => ({ publishedAt: "2026-07-23T00:00:00.000Z", objects: [] }),
      },
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
    const app = createApp(createDevDependencies());

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
    harness.dependencies.repositoryRuntimePlugins.register({
      ecosystem: "demo",
      name: "demo-plugin",
      version: "0.1.0",
      capabilities: ["admin-resources"],
      canServeRepositoryPath: () => false,
      validateRepositoryConfig: () => {},
      publish: {
        validateArtifacts: () => {},
        authorize: () => {},
        finalize: async () => ({ publishedAt: "2026-07-23T00:00:00.000Z", objects: [] }),
      },
      adminResources: {
        namespace: "demo",
        routes: [
          {
            name: "status",
            method: "GET",
            path: ["status"],
            responseKind: "json",
            handle: async ({ repository, params }) => new Response(JSON.stringify({
              repository: repository!.name,
              params,
            }), {
              headers: { "content-type": "application/json; charset=utf-8" },
            }),
          },
        ],
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
      params: {},
    });
  });

  it("requires admin auth before listing repository plugin metadata", async () => {
    const app = createApp(createDevDependencies());

    const response = await app.fetch(new Request("https://axis.example/admin/repository-plugins"));

    expect(response.status).toBe(401);
  });

  it("lists catalog plugins even when runtime metadata is not registered", async () => {
    const harness = createDevDependencyHarness();
    harness.dependencies.repositoryRuntimePlugins = new RepositoryRuntimePluginRegistry();
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
          experimental: false,
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
    const app = createApp(createDevDependencies());
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

  it("provisions APT signing keys during repository creation", async () => {
    const app = createApp(createDevDependencies());
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
          config: {
            apt: {
              codename: "noble",
            },
          },
          provisioning: {
            apt: {
              signingKey: {
                mode: "generate",
                name: "release",
                userIdName: "Axis Repository",
                userIdEmail: "axis@example.test",
              },
            },
          },
        }),
      }),
    );

    expect(response.status).toBe(201);
    const body = await response.json() as { config: { apt: { signingKeyId?: string } } };
    expect(body.config.apt.signingKeyId).toEqual(expect.stringMatching(/^repository_secret_/));

    const keys = await app.fetch(
      new Request("https://axis.example/admin/repositories/debian-internal/apt/signing-keys", {
        headers: { authorization: "Bearer dev-admin-token" },
      }),
    );
    await expect(keys.json()).resolves.toMatchObject({
      signingKeys: [
        {
          name: "release",
          repositoryName: "debian-internal",
          id: body.config.apt.signingKeyId,
        },
      ],
    });
  });

  it("gets repositories by name through admin routes", async () => {
    const app = createApp(createDevDependencies());
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
    const app = createApp(createDevDependencies());
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
    const app = createApp(createDevDependencies());
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
    const app = createApp(createDevDependencies());
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
    const app = createApp(createDevDependencies());
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
    const app = createApp(createDevDependencies());
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
    const app = createApp(createDevDependencies());
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
    const app = createApp(createDevDependencies());
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
    const app = createApp(createDevDependencies());
    const signingKey = await createSigningKey(app);
    await createRepository(app, {
      name: "debian-public",
      ecosystem: "apt",
      visibility: "public",
      config: {
        apt: {
          codename: "noble",
          suites: ["noble", "jammy"],
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
      suites: ["noble", "jammy"],
      components: ["main", "contrib"],
      keyringPath: "/usr/share/keyrings/axis-debian-public.gpg",
      sourceLine:
        "deb [signed-by=/usr/share/keyrings/axis-debian-public.gpg] https://axis.example/repositories/debian-public noble main contrib",
      // A repository publishing several suites needs a line for each, or the
      // ones a client never lists are unreachable however well they publish.
      sourceLines: [
        "deb [signed-by=/usr/share/keyrings/axis-debian-public.gpg] https://axis.example/repositories/debian-public noble main contrib",
        "deb [signed-by=/usr/share/keyrings/axis-debian-public.gpg] https://axis.example/repositories/debian-public jammy main contrib",
      ],
      sourcePackageLines: [
        "deb-src [signed-by=/usr/share/keyrings/axis-debian-public.gpg] https://axis.example/repositories/debian-public noble main contrib",
        "deb-src [signed-by=/usr/share/keyrings/axis-debian-public.gpg] https://axis.example/repositories/debian-public jammy main contrib",
      ],
    });
  });

  it("returns public apt install instructions", async () => {
    const app = createApp(createDevDependencies());
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
    const app = createApp(createDevDependencies());
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
    harness.dependencies.repositoryRuntimePlugins.register({
      ecosystem: "gems",
      name: "gems-simple",
      version: "0.1.0",
      capabilities: ["serve:simple"],
      canServeRepositoryPath: ({ relativePath }) =>
        relativePath === "simple" || relativePath.startsWith("simple/"),
      validateRepositoryConfig: () => {},
      publish: {
        validateArtifacts: () => {},
        authorize: () => {},
        finalize: async () => ({ publishedAt: "2026-07-18T00:00:00.000Z", objects: [] }),
      },
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
    harness.dependencies.repositoryRuntimePlugins.register({
      ecosystem: "gems",
      name: "gems-simple",
      version: "0.1.0",
      capabilities: ["client-helpers"],
      canServeRepositoryPath: () => false,
      validateRepositoryConfig: () => {},
      publish: {
        validateArtifacts: () => {},
        authorize: () => {},
        finalize: async () => ({ publishedAt: "2026-07-18T00:00:00.000Z", objects: [] }),
      },
      clientHelpers: {
        namespace: "simple",
        actions: [
          {
            name: "install",
            label: "Install",
            responseKind: "text",
            defaultOpen: true,
            public: true,
            handle: async ({ repository }) =>
              new Response(`${repository.ecosystem}:${repository.name}:install`),
          },
        ],
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
    const app = createApp(createDevDependencies());
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
    harness.dependencies.repositoryRuntimePlugins.register({
      ecosystem: "gems",
      name: "gems-simple",
      version: "0.1.0",
      capabilities: ["client-helpers"],
      canServeRepositoryPath: () => false,
      validateRepositoryConfig: () => {},
      publish: {
        validateArtifacts: () => {},
        authorize: () => {},
        finalize: async () => ({ publishedAt: "2026-07-18T00:00:00.000Z", objects: [] }),
      },
      clientHelpers: {
        namespace: "simple",
        actions: [
          {
            name: "tokened",
            label: "Tokened",
            responseKind: "text",
            defaultOpen: true,
            public: false,
            handle: async () => new Response("private-helper"),
          },
        ],
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

  it("keeps one origin serving everything when no artifact origin is configured", async () => {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    await createRepository(app, {
      name: "debian-public",
      ecosystem: "apt",
      visibility: "public",
    });
    await harness.repositoryObjectStore.putText(
      "repositories/debian-public/dists/noble/Release",
      "release",
      "text/plain",
    );

    // The default must be indistinguishable from before the split existed.
    const object = await app.fetch(
      new Request("https://axis.example/repositories/debian-public/dists/noble/Release"),
    );
    const ui = await app.fetch(new Request("https://axis.example/ui/"));
    const admin = await app.fetch(new Request("https://axis.example/admin/repositories", {
      headers: { authorization: "Bearer dev-admin-token" },
    }));

    expect(object.status).toBe(200);
    expect(ui.status).toBe(200);
    expect(admin.status).toBe(200);
  });

  it("splits artifact and admin hosts when an artifact origin is configured", async () => {
    const harness = createDevDependencyHarness();
    const app = createApp({
      ...harness.dependencies,
      artifactOrigin: "https://cdn.axis.example",
    });
    await createRepository(app, {
      name: "debian-public",
      ecosystem: "apt",
      visibility: "public",
    });
    await harness.repositoryObjectStore.putText(
      "repositories/debian-public/dists/noble/Release",
      "release",
      "text/plain",
    );

    const objectOnCdn = await app.fetch(
      new Request("https://cdn.axis.example/repositories/debian-public/dists/noble/Release"),
    );
    const objectOnAdmin = await app.fetch(
      new Request("https://axis.example/repositories/debian-public/dists/noble/Release"),
    );
    const uiOnAdmin = await app.fetch(new Request("https://axis.example/ui/"));
    const uiOnCdn = await app.fetch(new Request("https://cdn.axis.example/ui/"));
    const logoOnCdn = await app.fetch(new Request("https://cdn.axis.example/logo-mark-light.svg"));
    const adminOnCdn = await app.fetch(new Request("https://cdn.axis.example/admin/repositories", {
      headers: { authorization: "Bearer dev-admin-token" },
    }));

    // Publisher-controlled bytes must not be reachable on the origin the admin
    // UI runs on, which is the entire point of the split.
    expect(objectOnCdn.status).toBe(200);
    expect(objectOnAdmin.status).toBe(404);
    expect(uiOnAdmin.status).toBe(200);
    expect(uiOnCdn.status).toBe(404);
    expect(logoOnCdn.status).toBe(200);
    expect(logoOnCdn.headers.get("content-type")).toBe("image/svg+xml");
    await expect(logoOnCdn.text()).resolves.not.toContain("<!DOCTYPE html>");
    expect(adminOnCdn.status).toBe(404);
  });

  it("advertises the artifact origin in client-facing URLs", async () => {
    const app = createApp({
      ...createDevDependencyHarness().dependencies,
      artifactOrigin: "https://cdn.axis.example",
    });
    const signingKey = await createSigningKey(app);
    await createRepository(app, {
      name: "debian-internal",
      ecosystem: "apt",
      visibility: "public",
      config: validAptConfig(signingKey.id),
    });

    // Requested on the admin origin, but a sources.list line pointing at the
    // admin origin would now 404.
    const source = await app.fetch(new Request(
      "https://axis.example/admin/repositories/debian-internal/apt/client/source",
      { headers: { authorization: "Bearer dev-admin-token" } },
    ));

    await expect(source.json()).resolves.toMatchObject({
      sourceLine: expect.stringContaining("https://cdn.axis.example/repositories/debian-internal"),
    });
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
    harness.dependencies.repositoryRuntimePlugins.register({
      ecosystem: "gems",
      name: "gems-simple",
      version: "0.1.0",
      capabilities: ["serve:simple"],
      canServeRepositoryPath: ({ relativePath }) =>
        relativePath === "simple" || relativePath.startsWith("simple/"),
      validateRepositoryConfig: () => {},
      publish: {
        validateArtifacts: () => {},
        authorize: () => {},
        finalize: async () => ({
          publishedAt: "2026-07-18T00:00:30.000Z",
          objects: [],
        }),
      },
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

  it("neutralizes publisher-controlled content types on repository objects", async () => {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    await createRepository(app, {
      name: "debian-public",
      ecosystem: "apt",
      visibility: "public",
    });
    await harness.repositoryObjectStore.putText(
      "repositories/debian-public/pool/main/a/evil.html",
      "<script>alert(document.cookie)</script>",
      "text/html",
    );

    const response = await app.fetch(
      new Request("https://axis.example/repositories/debian-public/pool/main/a/evil.html"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-disposition")).toBe("attachment");
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
  });

  it("serves the admin UI shell with a nonce-scoped content security policy", async () => {
    const app = createApp(createDevDependencies());

    const response = await app.fetch(new Request("https://axis.example/ui/"));
    const body = await response.text();
    const policy = response.headers.get("content-security-policy") ?? "";
    const nonce = policy.match(/'nonce-([a-f0-9]+)'/)?.[1];

    expect(response.status).toBe(200);
    expect(nonce).toMatch(/^[a-f0-9]{32}$/);
    // The nonce is what the policy trusts; what the script says beyond that is
    // the injection's business, not this test's.
    expect(body).toContain(`<script nonce="${nonce}">`);
    expect(body).toContain("window.__AXIS_ADMIN_CONFIG__");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("base-uri 'none'");

    // Repository objects are served from this origin with a publisher-chosen
    // content type, so a host source in script-src would let an uploaded
    // artifact be loaded as a script.
    expect(policy).toContain(`script-src 'nonce-${nonce}' 'strict-dynamic'`);
    expect(policy).not.toMatch(/script-src[^;]*'self'/);
    expect(policy).not.toMatch(/script-src[^;]*https:/);

    // Every script the shell loads must carry the nonce, including the build's
    // own module script, or nonce-only would simply break the app.
    const scriptTags = body.match(/<script\b[^>]*>/gi) ?? [];
    expect(scriptTags.length).toBeGreaterThanOrEqual(2);
    for (const tag of scriptTags) {
      expect(tag, tag).toContain(`nonce="${nonce}"`);
    }
  });

  it("narrows connect-src to the presigned upload host", async () => {
    const sameOrigin = createApp(createDevDependencies());
    const presigned = createApp(createDevDependencies(undefined, {
      uploadOrigin: "https://account123.r2.cloudflarestorage.com",
    }));

    const sameOriginPolicy = (await sameOrigin.fetch(new Request("https://axis.example/ui/")))
      .headers.get("content-security-policy") ?? "";
    const presignedPolicy = (await presigned.fetch(new Request("https://axis.example/ui/")))
      .headers.get("content-security-policy") ?? "";

    // Allowing all of https: would be an open exfiltration channel after any
    // injection; only the host uploads actually go to is needed.
    expect(sameOriginPolicy).toContain("connect-src 'self';");
    expect(presignedPolicy).toContain(
      "connect-src 'self' https://account123.r2.cloudflarestorage.com;",
    );
    expect(sameOriginPolicy).not.toMatch(/connect-src[^;]*\bhttps:(?!\/\/)/);
    expect(presignedPolicy).not.toMatch(/connect-src[^;]*\bhttps:(?!\/\/)/);
  });

  it("issues a fresh admin UI script nonce per response", async () => {
    const app = createApp(createDevDependencies());

    const first = await app.fetch(new Request("https://axis.example/ui/"));
    const second = await app.fetch(new Request("https://axis.example/ui/"));

    expect(first.headers.get("content-security-policy")).not.toBe(
      second.headers.get("content-security-policy"),
    );
  });

  it("applies baseline security headers to every response", async () => {
    const app = createApp(createDevDependencies());

    const health = await app.fetch(new Request("https://axis.example/health"));
    const notFound = await app.fetch(new Request("https://axis.example/api/unknown"));
    const insecure = await app.fetch(new Request("http://localhost:8787/health"));

    for (const response of [health, notFound]) {
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(response.headers.get("x-frame-options")).toBe("DENY");
      expect(response.headers.get("strict-transport-security")).toBe(
        "max-age=31536000; includeSubDomains",
      );
    }
    expect(insecure.headers.get("strict-transport-security")).toBeNull();
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

  it("lists repository objects for the admin file browser using repository-relative paths", async () => {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    await createRepository(app, {
      name: "debian-private",
      ecosystem: "apt",
      visibility: "private",
    });
    await harness.repositoryObjectStore.putText(
      "repositories/debian-private/dists/noble/Release",
      "release",
      "text/plain",
    );
    await harness.repositoryObjectStore.putText(
      "repositories/debian-private/dists/noble/main/binary-amd64/Packages",
      "packages",
      "text/plain",
    );
    await harness.repositoryObjectStore.putBytes(
      "repositories/debian-private/pool/main/app/app_1.0.0_amd64.deb",
      new Uint8Array([1, 2, 3]),
      "application/vnd.debian.binary-package",
    );

    const root = await app.fetch(new Request(
      "https://axis.example/admin/repositories/debian-private/objects",
      { headers: { authorization: "Bearer dev-admin-token" } },
    ));
    const nested = await app.fetch(new Request(
      "https://axis.example/admin/repositories/debian-private/objects?prefix=dists%2Fnoble%2F",
      { headers: { authorization: "Bearer dev-admin-token" } },
    ));

    expect(root.status).toBe(200);
    await expect(root.json()).resolves.toEqual({
      prefix: "",
      directories: [
        { name: "dists", path: "dists/" },
        { name: "pool", path: "pool/" },
      ],
      objects: [],
      truncated: false,
    });
    expect(nested.status).toBe(200);
    await expect(nested.json()).resolves.toMatchObject({
      prefix: "dists/noble/",
      directories: [{ name: "main", path: "dists/noble/main/" }],
      objects: [{
        name: "Release",
        path: "dists/noble/Release",
        size: 7,
        contentType: "text/plain",
      }],
      truncated: false,
    });
  });

  it("requires admin auth for repository object listings", async () => {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    await createRepository(app, {
      name: "debian-private",
      ecosystem: "apt",
      visibility: "private",
    });

    const response = await app.fetch(new Request("https://axis.example/admin/repositories/debian-private/objects"));

    expect(response.status).toBe(401);
  });

  it("lists indexed repository artifacts through an admin route", async () => {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    const { token, session } = await createPublishSession(app, harness.repositoryObjectStore);
    const uploadId = session.uploads[0]?.uploadId;
    expect(uploadId).toBeDefined();

    const verify = await app.fetch(new Request(
      `https://axis.example/api/publish-sessions/${session.id}/uploads/${uploadId}/verify`,
      { method: "POST", headers: { authorization: `Bearer ${token}` } },
    ));
    expect(verify.status).toBe(200);
    const finalize = await app.fetch(new Request(
      `https://axis.example/api/publish-sessions/${session.id}/finalize`,
      { method: "POST", headers: { authorization: `Bearer ${token}` } },
    ));
    expect(finalize.status).toBe(200);

    const response = await app.fetch(new Request(
      "https://axis.example/admin/repositories/debian-internal/artifacts",
      { headers: { authorization: "Bearer dev-admin-token" } },
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      artifacts: [{
        repositoryName: "debian-internal",
        ecosystem: "apt",
        identity: "apt:main:myapp:1.2.3:amd64",
        name: "myapp",
        version: "1.2.3",
        summary: "myapp 1.2.3 amd64",
        primaryObjectKey: "repositories/debian-internal/pool/main/myapp/myapp_1.2.3_amd64.deb",
        metadata: {
          architecture: "amd64",
          component: "main",
        },
      }],
      truncated: false,
    });
  });

  it("deletes indexed artifacts by removing their repository objects and recording activity", async () => {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    const { token, session } = await createPublishSession(app, harness.repositoryObjectStore);
    const uploadId = session.uploads[0]?.uploadId;
    expect(uploadId).toBeDefined();
    await app.fetch(new Request(
      `https://axis.example/api/publish-sessions/${session.id}/uploads/${uploadId}/verify`,
      { method: "POST", headers: { authorization: `Bearer ${token}` } },
    ));
    await app.fetch(new Request(
      `https://axis.example/api/publish-sessions/${session.id}/finalize`,
      { method: "POST", headers: { authorization: `Bearer ${token}` } },
    ));
    const artifactsResponse = await app.fetch(new Request(
      "https://axis.example/admin/repositories/debian-internal/artifacts",
      { headers: { authorization: "Bearer dev-admin-token" } },
    ));
    const artifactsBody = await artifactsResponse.json() as { artifacts: Array<{ id: string; objectKeys: string[] }> };
    const artifact = artifactsBody.artifacts[0];
    expect(artifact).toBeDefined();

    const deleted = await app.fetch(new Request(
      `https://axis.example/admin/repositories/debian-internal/artifacts/${encodeURIComponent(artifact!.id)}`,
      { method: "DELETE", headers: { authorization: "Bearer dev-admin-token" } },
    ));
    const artifactsAfterDelete = await app.fetch(new Request(
      "https://axis.example/admin/repositories/debian-internal/artifacts",
      { headers: { authorization: "Bearer dev-admin-token" } },
    ));
    const activity = await app.fetch(new Request(
      "https://axis.example/admin/repositories/debian-internal/activity",
      { headers: { authorization: "Bearer dev-admin-token" } },
    ));

    expect(deleted.status).toBe(200);
    await expect(deleted.json()).resolves.toMatchObject({
      artifact: {
        id: artifact!.id,
      },
      artifacts: [],
      deletedObjectKeys: artifact!.objectKeys,
      missingObjectKeys: [],
      skippedObjectKeys: [],
      failedObjectKeys: [],
      truncated: false,
      activity: {
        repositoryName: "debian-internal",
        type: "artifact.delete",
        actor: "admin",
        summary: "Deleted artifact myapp 1.2.3 amd64",
        metadata: {
          artifactId: artifact!.id,
          objectKeys: artifact!.objectKeys,
          deletedObjectKeys: artifact!.objectKeys,
          missingObjectKeys: [],
          skippedObjectKeys: [],
          failedObjectKeys: [],
        },
      },
    });
    await expect(harness.repositoryObjectStore.headObject(artifact!.objectKeys[0]!)).resolves.toBeNull();
    await expect(artifactsAfterDelete.json()).resolves.toEqual({ artifacts: [], truncated: false });
    // Leaving the stanza behind would keep apt asking for a .deb that is gone,
    // and the signed Release would still vouch for that index. The index file
    // itself stays and goes empty, because Release still names the
    // architecture and apt refuses one it has no index for.
    expect(readStoredText(
      harness.repositoryObjectStore,
      "repositories/debian-internal/dists/noble/main/binary-amd64/Packages",
    )).toBe("");
    expect(readStoredText(harness.repositoryObjectStore, "repositories/debian-internal/dists/noble/Release"))
      .toContain("main/binary-amd64/Packages");
    const activityBody = await activity.json() as { activities: Array<{ type: string; metadata: Record<string, unknown> }> };
    expect(activityBody.activities[0]).toMatchObject({
      type: "artifact-index.rebuild",
      metadata: {
        artifactCount: 0,
      },
    });
    expect(activityBody.activities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "artifact.delete",
        metadata: expect.objectContaining({
          artifactId: artifact!.id,
        }),
      }),
    ]));
  });

  it("rebuilds repository artifact indexes from current storage", async () => {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    const { token, session } = await createPublishSession(app, harness.repositoryObjectStore);
    const uploadId = session.uploads[0]?.uploadId;
    expect(uploadId).toBeDefined();
    await app.fetch(new Request(
      `https://axis.example/api/publish-sessions/${session.id}/uploads/${uploadId}/verify`,
      { method: "POST", headers: { authorization: `Bearer ${token}` } },
    ));
    await app.fetch(new Request(
      `https://axis.example/api/publish-sessions/${session.id}/finalize`,
      { method: "POST", headers: { authorization: `Bearer ${token}` } },
    ));
    await harness.repositoryObjectStore.deleteObject(
      "repositories/debian-internal/pool/main/myapp/myapp_1.2.3_amd64.deb",
    );

    const rebuild = await app.fetch(new Request(
      "https://axis.example/admin/repositories/debian-internal/artifacts/rebuild-index",
      { method: "POST", headers: { authorization: "Bearer dev-admin-token" } },
    ));
    const artifacts = await app.fetch(new Request(
      "https://axis.example/admin/repositories/debian-internal/artifacts",
      { headers: { authorization: "Bearer dev-admin-token" } },
    ));

    expect(rebuild.status).toBe(200);
    await expect(rebuild.json()).resolves.toEqual({ artifacts: [], truncated: false });
    await expect(artifacts.json()).resolves.toEqual({ artifacts: [], truncated: false });
  });

  it("records repository activity when rebuilding artifact indexes", async () => {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    await createRepository(app, {
      name: "debian-private",
      ecosystem: "apt",
      visibility: "private",
    });

    const rebuild = await app.fetch(new Request(
      "https://axis.example/admin/repositories/debian-private/artifacts/rebuild-index",
      { method: "POST", headers: { authorization: "Bearer dev-admin-token" } },
    ));
    const activity = await app.fetch(new Request(
      "https://axis.example/admin/repositories/debian-private/activity",
      { headers: { authorization: "Bearer dev-admin-token" } },
    ));

    expect(rebuild.status).toBe(200);
    expect(activity.status).toBe(200);
    await expect(activity.json()).resolves.toMatchObject({
      activities: [{
        repositoryName: "debian-private",
        type: "artifact-index.rebuild",
        actor: "admin",
        summary: "Rebuilt artifact index",
        metadata: {
          artifactCount: 0,
        },
      }],
      truncated: false,
    });
  });

  it("rebuilds artifact indexes after deleting repository content objects", async () => {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    const { token, session } = await createPublishSession(app, harness.repositoryObjectStore);
    const uploadId = session.uploads[0]?.uploadId;
    expect(uploadId).toBeDefined();
    await app.fetch(new Request(
      `https://axis.example/api/publish-sessions/${session.id}/uploads/${uploadId}/verify`,
      { method: "POST", headers: { authorization: `Bearer ${token}` } },
    ));
    await app.fetch(new Request(
      `https://axis.example/api/publish-sessions/${session.id}/finalize`,
      { method: "POST", headers: { authorization: `Bearer ${token}` } },
    ));

    const deleted = await app.fetch(new Request(
      "https://axis.example/admin/repositories/debian-internal/objects?path=pool%2Fmain%2Fmyapp%2Fmyapp_1.2.3_amd64.deb",
      { method: "DELETE", headers: { authorization: "Bearer dev-admin-token" } },
    ));
    const artifacts = await app.fetch(new Request(
      "https://axis.example/admin/repositories/debian-internal/artifacts",
      { headers: { authorization: "Bearer dev-admin-token" } },
    ));

    expect(deleted.status).toBe(200);
    await expect(artifacts.json()).resolves.toEqual({ artifacts: [], truncated: false });
  });

  it("returns repository object detail metadata through the admin file browser", async () => {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    await createRepository(app, {
      name: "debian-private",
      ecosystem: "apt",
      visibility: "private",
    });
    await harness.repositoryObjectStore.putBytes(
      "repositories/debian-private/pool/main/app/app_1.0.0_amd64.deb",
      new Uint8Array([1, 2, 3]),
      "application/vnd.debian.binary-package",
    );

    const response = await app.fetch(new Request(
      "https://axis.example/admin/repositories/debian-private/objects/detail?path=pool%2Fmain%2Fapp%2Fapp_1.0.0_amd64.deb",
      { headers: { authorization: "Bearer dev-admin-token" } },
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      object: {
        name: "app_1.0.0_amd64.deb",
        path: "pool/main/app/app_1.0.0_amd64.deb",
        objectKey: "repositories/debian-private/pool/main/app/app_1.0.0_amd64.deb",
        size: 3,
        contentType: "application/vnd.debian.binary-package",
        repositoryUrl: "https://axis.example/repositories/debian-private/pool/main/app/app_1.0.0_amd64.deb",
      },
    });
  });

  it("deletes repository objects through the admin file browser and records activity", async () => {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    await createRepository(app, {
      name: "debian-private",
      ecosystem: "apt",
      visibility: "private",
    });
    await harness.repositoryObjectStore.putBytes(
      "repositories/debian-private/pool/main/app/app_1.0.0_amd64.deb",
      new Uint8Array([1, 2, 3]),
      "application/vnd.debian.binary-package",
    );

    const deleteResponse = await app.fetch(new Request(
      "https://axis.example/admin/repositories/debian-private/objects?path=pool%2Fmain%2Fapp%2Fapp_1.0.0_amd64.deb",
      { method: "DELETE", headers: { authorization: "Bearer dev-admin-token" } },
    ));
    const listing = await app.fetch(new Request(
      "https://axis.example/admin/repositories/debian-private/objects?prefix=pool%2Fmain%2Fapp%2F",
      { headers: { authorization: "Bearer dev-admin-token" } },
    ));
    const activity = await app.fetch(new Request(
      "https://axis.example/admin/repositories/debian-private/activity",
      { headers: { authorization: "Bearer dev-admin-token" } },
    ));

    expect(deleteResponse.status).toBe(200);
    await expect(deleteResponse.json()).resolves.toMatchObject({
      activity: {
        type: "object.delete",
        repositoryName: "debian-private",
        summary: "Deleted pool/main/app/app_1.0.0_amd64.deb",
        metadata: {
          path: "pool/main/app/app_1.0.0_amd64.deb",
          objectKey: "repositories/debian-private/pool/main/app/app_1.0.0_amd64.deb",
          contentType: "application/vnd.debian.binary-package",
          size: 3,
        },
      },
    });
    await expect(listing.json()).resolves.toMatchObject({ objects: [] });
    const activityBody = await activity.json() as { activities: Array<{ type: string; summary: string; metadata: Record<string, unknown> }> };
    expect(activityBody.activities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "artifact-index.rebuild",
        metadata: {
          artifactCount: 0,
        },
      }),
      expect.objectContaining({
        type: "object.delete",
        summary: "Deleted pool/main/app/app_1.0.0_amd64.deb",
      }),
    ]));
  });

  it("paginates repository activity timelines with an opaque cursor", async () => {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    await createRepository(app, {
      name: "debian-private",
      ecosystem: "apt",
      visibility: "private",
    });
    for (const path of [
      "pool/main/app/app_1.0.0_amd64.deb",
      "pool/main/app/app_1.0.1_amd64.deb",
      "pool/main/app/app_1.0.2_amd64.deb",
    ]) {
      await harness.repositoryObjectStore.putBytes(
        `repositories/debian-private/${path}`,
        new Uint8Array([1, 2, 3]),
        "application/vnd.debian.binary-package",
      );
      const response = await app.fetch(new Request(
        `https://axis.example/admin/repositories/debian-private/objects?path=${encodeURIComponent(path)}`,
        { method: "DELETE", headers: { authorization: "Bearer dev-admin-token" } },
      ));
      expect(response.status).toBe(200);
    }

    const firstPage = await app.fetch(new Request(
      "https://axis.example/admin/repositories/debian-private/activity?limit=2",
      { headers: { authorization: "Bearer dev-admin-token" } },
    ));
    expect(firstPage.status).toBe(200);
    const firstPageBody = (await firstPage.json()) as {
      activities: Array<{ id: string; type: string }>;
      cursor?: string;
      truncated: boolean;
    };

    expect(firstPageBody.activities).toHaveLength(2);
    expect(firstPageBody.truncated).toBe(true);
    expect(firstPageBody.cursor).toEqual(expect.any(String));

    const secondPage = await app.fetch(new Request(
      `https://axis.example/admin/repositories/debian-private/activity?limit=2&cursor=${encodeURIComponent(firstPageBody.cursor ?? "")}`,
      { headers: { authorization: "Bearer dev-admin-token" } },
    ));
    expect(secondPage.status).toBe(200);
    const secondPageBody = (await secondPage.json()) as {
      activities: Array<{ id: string; type: string }>;
      cursor?: string;
      truncated: boolean;
    };

    expect(secondPageBody.activities).toHaveLength(2);
    expect(secondPageBody.truncated).toBe(true);
    expect(secondPageBody.cursor).toEqual(expect.any(String));

    const thirdPage = await app.fetch(new Request(
      `https://axis.example/admin/repositories/debian-private/activity?limit=2&cursor=${encodeURIComponent(secondPageBody.cursor ?? "")}`,
      { headers: { authorization: "Bearer dev-admin-token" } },
    ));
    expect(thirdPage.status).toBe(200);
    const thirdPageBody = (await thirdPage.json()) as {
      activities: Array<{ id: string; type: string }>;
      cursor?: string;
      truncated: boolean;
    };

    expect(thirdPageBody.activities).toHaveLength(2);
    expect(thirdPageBody.truncated).toBe(false);
    expect(thirdPageBody.cursor).toBeUndefined();
    const pagedActivities = [
      ...firstPageBody.activities.map((activity) => activity.id),
      ...secondPageBody.activities.map((activity) => activity.id),
      ...thirdPageBody.activities.map((activity) => activity.id),
    ];
    expect(new Set(pagedActivities).size).toBe(6);
    expect([
      ...firstPageBody.activities,
      ...secondPageBody.activities,
      ...thirdPageBody.activities,
    ].filter((activity) => activity.type === "object.delete")).toHaveLength(3);
    expect([
      ...firstPageBody.activities,
      ...secondPageBody.activities,
      ...thirdPageBody.activities,
    ].filter((activity) => activity.type === "artifact-index.rebuild")).toHaveLength(3);
  });

  it("rejects malformed repository activity pagination parameters", async () => {
    const app = createApp(createDevDependencies());
    await createRepository(app, {
      name: "debian-private",
      ecosystem: "apt",
      visibility: "private",
    });

    const response = await app.fetch(new Request(
      "https://axis.example/admin/repositories/debian-private/activity?limit=0",
      { headers: { authorization: "Bearer dev-admin-token" } },
    ));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "validation_error", message: "limit must be an integer between 1 and 100" },
    });
  });

  it("rejects repository object delete paths with traversal segments", async () => {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    await createRepository(app, {
      name: "debian-private",
      ecosystem: "apt",
      visibility: "private",
    });

    const response = await app.fetch(new Request(
      "https://axis.example/admin/repositories/debian-private/objects?path=..%2Fsecret",
      { method: "DELETE", headers: { authorization: "Bearer dev-admin-token" } },
    ));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "validation_error", message: "path must be a repository-relative object path" },
    });
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
    const app = createApp(createDevDependencies());

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
    const app = createApp(createDevDependencies());
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
    const app = createApp(createDevDependencies());
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

  it("redacts upload capabilities and peer token scope when reading sessions back", async () => {
    const app = createApp(createDevDependencies());
    await createRepository(app, { name: "debian-internal", ecosystem: "apt" });
    const peerToken = await createToken(app, {
      name: "peer-ci",
      repositories: ["debian-internal"],
      permissions: ["publish"],
      ecosystemScopes: { apt: { allowedPackages: ["myapp"] } },
      signingKeyIds: ["signing_key_prod"],
    });
    const otherToken = await createToken(app, {
      name: "other-ci",
      repositories: ["debian-internal"],
      permissions: ["publish"],
      ecosystemScopes: { apt: { allowedPackages: ["myapp"] } },
      signingKeyIds: ["signing_key_prod"],
    });

    const createResponse = await app.fetch(new Request("https://axis.example/api/publish-sessions", {
      method: "POST",
      headers: { authorization: `Bearer ${peerToken}`, "content-type": "application/json" },
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
    const created = (await createResponse.json()) as {
      id: string;
      uploads: Array<Record<string, unknown>>;
    };

    // The creator gets the capability exactly once, at creation.
    expect(created.uploads[0]).toHaveProperty("url");
    expect(created.uploads[0]).toHaveProperty("headers");

    const listed = await app.fetch(new Request("https://axis.example/api/publish-sessions", {
      headers: { authorization: `Bearer ${otherToken}` },
    }));
    const listedBody = (await listed.json()) as {
      sessions: Array<{ uploads: Array<Record<string, unknown>>; requestedBy: Record<string, unknown> }>;
    };
    const peerSession = listedBody.sessions[0]!;

    expect(peerSession.uploads[0]).not.toHaveProperty("url");
    expect(peerSession.uploads[0]).not.toHaveProperty("headers");
    expect(peerSession.uploads[0]).toMatchObject({ uploadId: expect.any(String), filename: "myapp_1.2.3_amd64.deb" });
    // Identity and attribution stay; permissions, repositories, ecosystem
    // scopes, and signing key scope of the peer token do not.
    expect(Object.keys(peerSession.requestedBy).sort()).toEqual(["name", "owner", "tokenId"]);
    expect(peerSession.requestedBy).toMatchObject({ name: "peer-ci" });

    const fetched = await app.fetch(new Request(`https://axis.example/api/publish-sessions/${created.id}`, {
      headers: { authorization: `Bearer ${otherToken}` },
    }));
    const fetchedBody = (await fetched.json()) as { session: { uploads: Array<Record<string, unknown>> } };
    expect(fetchedBody.session.uploads[0]).not.toHaveProperty("url");

    const adminListed = await app.fetch(new Request("https://axis.example/admin/publish-sessions", {
      headers: { authorization: "Bearer dev-admin-token" },
    }));
    const adminBody = (await adminListed.json()) as {
      sessions: Array<{ uploads: Array<Record<string, unknown>> }>;
    };
    expect(adminBody.sessions[0]!.uploads[0]).not.toHaveProperty("url");
  });

  it("redacts upload capabilities from verify and finalize responses too", async () => {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    const debBytes = aptDebFixture();
    const debSha256 = await sha256Hex(debBytes);
    const signingKey = await createSigningKey(app);
    await createRepository(app, {
      name: "debian-internal",
      ecosystem: "apt",
      config: validAptConfig(signingKey.id),
    });
    const token = await createToken(app, {
      name: "github-actions",
      repositories: ["debian-internal"],
      permissions: ["publish"],
      ecosystemScopes: { apt: { allowedPackages: ["myapp"] } },
      signingKeyIds: [signingKey.id],
    });

    const createResponse = await app.fetch(new Request("https://axis.example/api/publish-sessions", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        repositoryName: "debian-internal",
        ecosystem: "apt",
        artifacts: [{
          filename: "myapp_1.2.3_amd64.deb",
          size: debBytes.byteLength,
          sha256: debSha256,
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
    const created = (await createResponse.json()) as {
      id: string;
      uploads: Array<{ uploadId: string; url: string }>;
    };
    const upload = created.uploads[0]!;

    await app.fetch(new Request(`https://axis.example${upload.url}`, {
      method: "PUT",
      headers: { "content-type": "application/vnd.debian.binary-package" },
      body: debBytes,
    }));

    const verifyResponse = await app.fetch(new Request(
      `https://axis.example/api/publish-sessions/${created.id}/uploads/${upload.uploadId}/verify`,
      { method: "POST", headers: { authorization: `Bearer ${token}` } },
    ));
    const verified = (await verifyResponse.json()) as {
      session: { uploads: Array<Record<string, unknown>>; requestedBy: Record<string, unknown> };
    };

    expect(verifyResponse.status).toBe(200);
    // The capability is issued once, at create. Every later response that
    // echoes the session must drop it, not just the GETs.
    expect(verified.session.uploads[0]).not.toHaveProperty("url");
    expect(verified.session.uploads[0]).not.toHaveProperty("headers");
    expect(Object.keys(verified.session.requestedBy).sort()).toEqual(["name", "owner", "tokenId"]);

    const finalizeResponse = await app.fetch(new Request(
      `https://axis.example/api/publish-sessions/${created.id}/finalize`,
      { method: "POST", headers: { authorization: `Bearer ${token}` } },
    ));
    const finalized = (await finalizeResponse.json()) as {
      session: { uploads: Array<Record<string, unknown>> };
    };

    expect(finalizeResponse.status).toBe(200);
    expect(finalized.session.uploads[0]).not.toHaveProperty("url");
  });

  it("answers identically for unknown and out-of-scope sessions on every session route", async () => {
    const app = createApp(createDevDependencies());
    await createRepository(app, { name: "debian-internal", ecosystem: "apt" });
    await createRepository(app, { name: "debian-staging", ecosystem: "apt" });
    const owner = await createToken(app, {
      name: "owner-ci",
      repositories: ["debian-internal"],
      permissions: ["publish"],
      ecosystemScopes: { apt: { allowedPackages: ["myapp"] } },
      signingKeyIds: ["signing_key_prod"],
    });
    const outsider = await createToken(app, {
      name: "outsider-ci",
      repositories: ["debian-staging"],
      permissions: ["publish"],
      ecosystemScopes: { apt: { allowedPackages: ["myapp"] } },
      signingKeyIds: ["signing_key_prod"],
    });

    const createResponse = await app.fetch(new Request("https://axis.example/api/publish-sessions", {
      method: "POST",
      headers: { authorization: `Bearer ${owner}`, "content-type": "application/json" },
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
    const created = (await createResponse.json()) as { id: string; uploads: Array<{ uploadId: string }> };
    const uploadId = created.uploads[0]!.uploadId;

    const probes: Array<[string, Request]> = [
      ["get", new Request(`https://axis.example/api/publish-sessions/${created.id}`)],
      ["get-missing", new Request("https://axis.example/api/publish-sessions/pub_missing")],
      ["verify", new Request(
        `https://axis.example/api/publish-sessions/${created.id}/uploads/${uploadId}/verify`,
        { method: "POST" },
      )],
      ["verify-missing", new Request(
        `https://axis.example/api/publish-sessions/pub_missing/uploads/${uploadId}/verify`,
        { method: "POST" },
      )],
      ["finalize", new Request(
        `https://axis.example/api/publish-sessions/${created.id}/finalize`,
        { method: "POST" },
      )],
      ["finalize-missing", new Request(
        "https://axis.example/api/publish-sessions/pub_missing/finalize",
        { method: "POST" },
      )],
    ];

    for (const [label, request] of probes) {
      const response = await app.fetch(new Request(request, {
        headers: { authorization: `Bearer ${outsider}` },
      }));
      const body = (await response.json()) as { error: { code: string; message: string } };

      expect(response.status, label).toBe(404);
      expect(body.error.code, label).toBe("not_found");
      // The message must not name the repository the session belongs to.
      expect(body.error.message, label).not.toContain("debian-internal");
    }
  });

  it("lists all publish sessions through the admin endpoint", async () => {
    const app = createApp(createDevDependencies());
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
    const debBytes = aptDebFixture();
    const debSha256 = await sha256Hex(debBytes);
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
          size: debBytes.byteLength,
          sha256: debSha256,
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
    await harness.repositoryObjectStore.putBytes(upload.objectKey, debBytes, "application/vnd.debian.binary-package");

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

  it("bounds same-origin uploads by declared size and session state", async () => {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    const debBytes = aptDebFixture();
    const debSha256 = await sha256Hex(debBytes);
    const signingKey = await createSigningKey(app);
    await createRepository(app, {
      name: "debian-internal",
      ecosystem: "apt",
      config: validAptConfig(signingKey.id),
    });

    const createSession = async () => {
      const response = await app.fetch(new Request("https://axis.example/admin/publish-sessions", {
        method: "POST",
        headers: { authorization: "Bearer dev-admin-token", "content-type": "application/json" },
        body: JSON.stringify({
          repositoryName: "debian-internal",
          ecosystem: "apt",
          artifacts: [{
            filename: "myapp_1.2.3_amd64.deb",
            size: debBytes.byteLength,
            sha256: debSha256,
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
      expect(response.status).toBe(201);
      return (await response.json()) as { id: string; uploads: Array<{ uploadId: string; url: string }> };
    };

    const oversized = await createSession();
    const oversizedUpload = oversized.uploads[0]!;
    const oversizedResponse = await app.fetch(new Request(`https://axis.example${oversizedUpload.url}`, {
      method: "PUT",
      headers: { "content-type": "application/vnd.debian.binary-package" },
      body: new Uint8Array(debBytes.byteLength + 1),
    }));

    expect(oversizedResponse.status).toBe(400);
    await expect(oversizedResponse.json()).resolves.toEqual({
      error: {
        code: "validation_error",
        message: "Uploaded object is larger than the declared artifact size",
      },
    });
    expect(harness.repositoryObjectStore.objects).toHaveLength(0);

    // Once a session leaves the open states its upload URLs must stop working.
    const finalized = await createSession();
    const finalizedUpload = finalized.uploads[0]!;
    await app.fetch(new Request(`https://axis.example${finalizedUpload.url}`, {
      method: "PUT",
      headers: { "content-type": "application/vnd.debian.binary-package" },
      body: debBytes,
    }));
    await app.fetch(new Request(
      `https://axis.example/admin/publish-sessions/${finalized.id}/uploads/${finalizedUpload.uploadId}/verify`,
      { method: "POST", headers: { authorization: "Bearer dev-admin-token" } },
    ));
    const finalizeResponse = await app.fetch(new Request(
      `https://axis.example/admin/publish-sessions/${finalized.id}/finalize`,
      { method: "POST", headers: { authorization: "Bearer dev-admin-token" } },
    ));
    expect(finalizeResponse.status).toBe(200);

    const replayResponse = await app.fetch(new Request(`https://axis.example${finalizedUpload.url}`, {
      method: "PUT",
      headers: { "content-type": "application/vnd.debian.binary-package" },
      body: debBytes,
    }));

    expect(replayResponse.status).toBe(400);
    await expect(replayResponse.json()).resolves.toEqual({
      error: { code: "validation_error", message: "Publish session is not open: finalized" },
    });
  });

  it("bounds a chunked upload that declares no content-length", async () => {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    const debBytes = aptDebFixture();
    const debSha256 = await sha256Hex(debBytes);
    const signingKey = await createSigningKey(app);
    await createRepository(app, {
      name: "debian-internal",
      ecosystem: "apt",
      config: validAptConfig(signingKey.id),
    });
    const response = await app.fetch(new Request("https://axis.example/admin/publish-sessions", {
      method: "POST",
      headers: { authorization: "Bearer dev-admin-token", "content-type": "application/json" },
      body: JSON.stringify({
        repositoryName: "debian-internal",
        ecosystem: "apt",
        artifacts: [{
          filename: "myapp_1.2.3_amd64.deb",
          size: debBytes.byteLength,
          sha256: debSha256,
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
    const session = (await response.json()) as { uploads: Array<{ url: string }> };
    const upload = session.uploads[0]!;

    // A streamed body carries no content-length, so the pre-check does not
    // apply and the limit has to hold as the stream is consumed.
    let pushed = 0;
    const oversized = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pushed >= 64) {
          controller.close();
          return;
        }
        pushed += 1;
        controller.enqueue(new Uint8Array(1024));
      },
    });

    const uploadResponse = await app.fetch(new Request(`https://axis.example${upload.url}`, {
      method: "PUT",
      headers: { "content-type": "application/vnd.debian.binary-package" },
      body: oversized,
      duplex: "half",
    } as RequestInit & { duplex: "half" }));

    expect(uploadResponse.status).toBe(400);
    await expect(uploadResponse.json()).resolves.toEqual({
      error: {
        code: "validation_error",
        message: "Uploaded object is larger than the declared artifact size",
      },
    });
    expect(harness.repositoryObjectStore.objects).toHaveLength(0);
  });

  it("refuses to overwrite an upload after it has been verified", async () => {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    const debBytes = aptDebFixture();
    const debSha256 = await sha256Hex(debBytes);
    const signingKey = await createSigningKey(app);
    await createRepository(app, {
      name: "debian-internal",
      ecosystem: "apt",
      config: validAptConfig(signingKey.id),
    });
    const response = await app.fetch(new Request("https://axis.example/admin/publish-sessions", {
      method: "POST",
      headers: { authorization: "Bearer dev-admin-token", "content-type": "application/json" },
      body: JSON.stringify({
        repositoryName: "debian-internal",
        ecosystem: "apt",
        artifacts: [{
          filename: "myapp_1.2.3_amd64.deb",
          size: debBytes.byteLength,
          sha256: debSha256,
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
    const session = (await response.json()) as {
      id: string;
      uploads: Array<{ uploadId: string; url: string }>;
    };
    const upload = session.uploads[0]!;

    await app.fetch(new Request(`https://axis.example${upload.url}`, {
      method: "PUT",
      headers: { "content-type": "application/vnd.debian.binary-package" },
      body: debBytes,
    }));
    const verifyResponse = await app.fetch(new Request(
      `https://axis.example/admin/publish-sessions/${session.id}/uploads/${upload.uploadId}/verify`,
      { method: "POST", headers: { authorization: "Bearer dev-admin-token" } },
    ));
    expect(verifyResponse.status).toBe(200);

    // finalize trusts the digest recorded at verify, so a later write would
    // publish bytes the signed index does not describe.
    const swapResponse = await app.fetch(new Request(`https://axis.example${upload.url}`, {
      method: "PUT",
      headers: { "content-type": "application/vnd.debian.binary-package" },
      body: new Uint8Array(debBytes.byteLength),
    }));

    expect(swapResponse.status).toBe(400);
    await expect(swapResponse.json()).resolves.toMatchObject({
      error: { message: "Publish session is not open: ready" },
    });
  });

  it("accepts local memory uploads through same-origin upload targets", async () => {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    const debBytes = aptDebFixture();
    const debSha256 = await sha256Hex(debBytes);
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
          size: debBytes.byteLength,
          sha256: debSha256,
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
      uploads: Array<{ uploadId: string; url: string }>;
    };
    const upload = session.uploads[0]!;

    expect(upload.url).toBe(`/api/uploads/${session.id}/${upload.uploadId}`);

    const uploadResponse = await app.fetch(new Request(`https://axis.example${upload.url}`, {
      method: "PUT",
      headers: { "content-type": "application/vnd.debian.binary-package" },
      body: debBytes,
    }));
    expect(uploadResponse.status).toBe(204);

    const verifyResponse = await app.fetch(new Request(
      `https://axis.example/admin/publish-sessions/${session.id}/uploads/${upload.uploadId}/verify`,
      {
        method: "POST",
        headers: { authorization: "Bearer dev-admin-token" },
      },
    ));
    expect(verifyResponse.status).toBe(200);
  });

  it("gets a publish session by id and hides sessions outside the repository scope", async () => {
    const app = createApp(createDevDependencies());
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
    const outOfScopeResponse = await app.fetch(
      new Request(`https://axis.example/api/publish-sessions/${session.id}`, {
        headers: { authorization: `Bearer ${externalToken}` },
      }),
    );
    const unknownResponse = await app.fetch(
      new Request("https://axis.example/api/publish-sessions/pub_does_not_exist", {
        headers: { authorization: `Bearer ${externalToken}` },
      }),
    );

    expect(getResponse.status).toBe(200);
    await expect(getResponse.json()).resolves.toMatchObject({
      session: { id: session.id, repositoryName: "debian-internal" },
    });
    // Identical responses, so the id cannot be probed for existence.
    expect(outOfScopeResponse.status).toBe(404);
    expect(unknownResponse.status).toBe(404);
  });

  it("verifies an uploaded artifact for a publish session", async () => {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    const debBytes = aptDebFixture();
    const debSha256 = await sha256Hex(debBytes);

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
              size: debBytes.byteLength,
              sha256: debSha256,
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
    await harness.repositoryObjectStore.putBytes(
      session.uploads[0]!.objectKey,
      debBytes,
      "application/vnd.debian.binary-package",
    );

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
        size: debBytes.byteLength,
        sha256: debSha256,
        verifiedAt: expect.any(String),
      },
      session: expect.objectContaining({
        id: session.id,
        status: "ready",
        verifiedUploads: [
          expect.objectContaining({
            uploadId,
            sha256: debSha256,
          }),
        ],
      }),
    });
  });

  it("rejects apt publish finalization when uploaded deb metadata cannot be parsed", async () => {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    const invalidDebBytes = new TextEncoder().encode("not a deb");
    const invalidDebSha256 = await sha256Hex(invalidDebBytes);
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

    const createResponse = await app.fetch(
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
              size: invalidDebBytes.byteLength,
              sha256: invalidDebSha256,
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

    expect(createResponse.status).toBe(201);
    const session = (await createResponse.json()) as {
      id: string;
      uploads: Array<{ uploadId: string; objectKey: string }>;
    };
    const upload = session.uploads[0]!;
    await harness.repositoryObjectStore.putBytes(
      upload.objectKey,
      invalidDebBytes,
      "application/vnd.debian.binary-package",
    );

    const verifyResponse = await app.fetch(new Request(
      `https://axis.example/api/publish-sessions/${session.id}/uploads/${upload.uploadId}/verify`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      },
    ));
    expect(verifyResponse.status).toBe(200);

    const finalizeResponse = await app.fetch(new Request(
      `https://axis.example/api/publish-sessions/${session.id}/finalize`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      },
    ));

    expect(finalizeResponse.status).toBe(400);
    await expect(finalizeResponse.json()).resolves.toEqual({
      error: { code: "validation_error", message: "APT artifact is not a Debian package archive" },
    });
  });

  it("rejects apt publish sessions without signing key scope before creating uploads", async () => {
    const app = createApp(createDevDependencies());
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
            { key: "repositories/debian-internal/dists/noble/main/i18n/Translation-en" },
            { key: "repositories/debian-internal/dists/noble/main/i18n/Translation-en.gz" },
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

  it("refuses to sign a repository with another repository's signing key", async () => {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    const debBytes = aptDebFixture();
    const debSha256 = await sha256Hex(debBytes);
    // createSigningKey imports into debian-internal, so this key belongs there.
    const victimKey = await createSigningKey(app);
    await createRepository(app, {
      name: "debian-internal",
      ecosystem: "apt",
      config: validAptConfig(victimKey.id),
    });
    await createRepository(app, {
      name: "debian-attacker",
      ecosystem: "apt",
      config: validAptConfig(victimKey.id),
    });

    const sessionResponse = await app.fetch(
      new Request("https://axis.example/admin/publish-sessions", {
        method: "POST",
        headers: {
          authorization: "Bearer dev-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          repositoryName: "debian-attacker",
          ecosystem: "apt",
          artifacts: [{
            filename: "myapp_1.2.3_amd64.deb",
            size: debBytes.byteLength,
            sha256: debSha256,
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
      }),
    );
    expect(sessionResponse.status).toBe(201);
    const session = (await sessionResponse.json()) as {
      id: string;
      uploads: Array<{ uploadId: string; url: string; headers: Record<string, string> }>;
    };
    const upload = session.uploads[0]!;

    await app.fetch(new Request(`https://axis.example${upload.url}`, {
      method: "PUT",
      headers: upload.headers,
      body: debBytes,
    }));
    await app.fetch(new Request(
      `https://axis.example/admin/publish-sessions/${session.id}/uploads/${upload.uploadId}/verify`,
      { method: "POST", headers: { authorization: "Bearer dev-admin-token" } },
    ));

    const finalizeResponse = await app.fetch(
      new Request(`https://axis.example/admin/publish-sessions/${session.id}/finalize`, {
        method: "POST",
        headers: { authorization: "Bearer dev-admin-token" },
      }),
    );

    expect(finalizeResponse.status).toBe(404);
    expect(
      harness.repositoryObjectStore.objects.some((object) =>
        object.key.startsWith("repositories/debian-attacker/dists/"),
      ),
    ).toBe(false);
  });

  it("fails closed when finalizing APT without matching signing key scope", async () => {
    const { generateKey } = await import("openpgp");
    const key = await generateKey({
      type: "ecc",
      curve: "curve25519Legacy",
      userIDs: [{ name: "Axis Test", email: "axis@example.test" }],
      passphrase: "correct-passphrase",
    });
    const app = createApp(createDevDependencies());

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
    const app = createApp(createDevDependencies());

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
    const app = createApp(createDevDependencies());
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
    const app = createApp(createDevDependencies());
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
    const app = createApp(createDevDependencies());

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

  it("records the admin user principal as the publish token owner", async () => {
    const app = createApp(createDevDependencies());

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
    await expect(createResponse.json()).resolves.toMatchObject({
      token: {
        owner: {
          type: "admin-user",
          subject: "admin_user_dev",
          displayName: "admin",
        },
      },
    });

    const listResponse = await app.fetch(
      new Request("https://axis.example/admin/publish-tokens", {
        headers: { authorization: "Bearer dev-admin-token" },
      }),
    );

    await expect(listResponse.json()).resolves.toMatchObject({
      publishTokens: [
        {
          name: "github-actions",
          owner: {
            type: "admin-user",
            subject: "admin_user_dev",
            displayName: "admin",
          },
        },
      ],
    });
  });

  it("gets publish tokens by name without exposing secrets or hashes", async () => {
    const app = createApp(createDevDependencies());
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
    const app = createApp(createDevDependencies());
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
    const app = createApp(createDevDependencies());
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

  it("rotates publish tokens by name and returns the one-time secret", async () => {
    const app = createApp(createDevDependencies());
    const originalSecret = await createToken(app, {
      name: "github-actions",
      repositories: ["debian-internal"],
      permissions: ["publish"],
      ecosystemScopes: {},
    });

    const response = await app.fetch(
      new Request("https://axis.example/admin/publish-tokens/github-actions/rotate", {
        method: "POST",
        headers: { authorization: "Bearer dev-admin-token" },
      }),
    );
    const body = (await response.json()) as { token: Record<string, unknown>; secret: string };

    expect(response.status).toBe(200);
    expect(body.secret).toMatch(/^axis_publish_/);
    expect(body.secret).not.toBe(originalSecret);
    expect(body.token).toMatchObject({
      name: "github-actions",
      rotatedAt: expect.any(String),
    });
    expect(body.token).not.toHaveProperty("tokenHash");
    expect(JSON.stringify(body.token)).not.toContain(body.secret);
  });

  it("deletes publish tokens by name", async () => {
    const app = createApp(createDevDependencies());
    await createToken(app, {
      name: "github-actions",
      repositories: ["debian-internal"],
      permissions: ["publish"],
      ecosystemScopes: {},
    });

    const response = await app.fetch(
      new Request("https://axis.example/admin/publish-tokens/github-actions", {
        method: "DELETE",
        headers: { authorization: "Bearer dev-admin-token" },
      }),
    );
    const getResponse = await app.fetch(
      new Request("https://axis.example/admin/publish-tokens/github-actions", {
        headers: { authorization: "Bearer dev-admin-token" },
      }),
    );

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(getResponse.status).toBe(404);
  });

  it("returns not found for missing publish token admin resources", async () => {
    const app = createApp(createDevDependencies());

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
    const app = createApp(createDevDependencies());
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
    const app = createApp(createDevDependencies());

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
    const app = createApp(createDevDependencies());

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
    expect(created.id).toMatch(/^repository_secret_/);
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
    const app = createApp(createDevDependencies());

    const response = await app.fetch(
      new Request("https://axis.example/admin/repositories/debian-prod/apt/signing-keys/signing_key_missing", {
        headers: { authorization: "Bearer dev-admin-token" },
      }),
    );

    expect(response.status).toBe(404);
  });

  it("requires admin auth for APT signing key revoke paths before method dispatch", async () => {
    const app = createApp(createDevDependencies());

    const response = await app.fetch(
      new Request("https://axis.example/admin/repositories/debian-prod/apt/signing-keys/signing_key_missing/revoke"),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "unauthorized", message: "Unauthorized" },
    });
  });

  it("creates a publish token with an explicit empty signing key scope", async () => {
    const app = createApp(createDevDependencies());

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
    const app = createApp(createDevDependencies());

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
    const app = createApp(createDevDependencies());

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
    const app = createApp(createDevDependencies());

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
    const app = createApp(createDevDependencies());

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

describe("concurrent publishes to one repository", () => {
  it("keeps both sessions' packages when they finalize at the same moment", async () => {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    const { token } = await createPublishSession(app, harness.repositoryObjectStore);

    async function publish(packageName: string) {
      const bytes = debArchive({
        control: [
          `Package: ${packageName}`,
          "Version: 1.0.0",
          "Architecture: amd64",
          "Maintainer: Release Team <release@example.com>",
          "Section: main",
          `Description: ${packageName}`,
        ].join("\n"),
      });
      const sha256 = await sha256Hex(bytes);
      const created = await app.fetch(new Request("https://axis.example/api/publish-sessions", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          repositoryName: "debian-internal",
          ecosystem: "apt",
          artifacts: [{
            filename: `${packageName}_1.0.0_amd64.deb`,
            size: bytes.byteLength,
            sha256,
            contentType: "application/vnd.debian.binary-package",
            metadata: { package: packageName, version: "1.0.0", architecture: "amd64", component: "main" },
          }],
        }),
      }));
      expect(created.status).toBe(201);
      const session = (await created.json()) as { id: string; uploads: Array<{ uploadId: string; objectKey: string }> };
      const upload = session.uploads[0]!;
      await harness.repositoryObjectStore.putBytes(upload.objectKey, bytes, "application/vnd.debian.binary-package");
      await app.fetch(new Request(
        `https://axis.example/api/publish-sessions/${session.id}/uploads/${upload.uploadId}/verify`,
        { method: "POST", headers: { authorization: `Bearer ${token}` } },
      ));
      return () => app.fetch(new Request(
        `https://axis.example/api/publish-sessions/${session.id}/finalize`,
        { method: "POST", headers: { authorization: `Bearer ${token}` } },
      ));
    }

    // Both sessions are prepared, then finalized together: each reads the
    // current index and writes back the merged result, so without ordering the
    // later write erases whatever the earlier one added.
    const finalizeAlpha = await publish("alpha");
    const finalizeBeta = await publish("beta");
    const responses = await Promise.all([finalizeAlpha(), finalizeBeta()]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const packages = readStoredText(
      harness.repositoryObjectStore,
      "repositories/debian-internal/dists/noble/main/binary-amd64/Packages",
    );
    expect(packages).toContain("Package: alpha\n");
    expect(packages).toContain("Package: beta\n");
  });
});

describe("serving a PyPI Simple index", () => {
  async function pypiHarness() {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    await createRepository(app, {
      name: "python-public",
      ecosystem: "pypi",
      visibility: "public",
      config: {},
    });
    return { harness, app };
  }

  it("answers the index URL pip is given, trailing slash and all", async () => {
    // PEP 503 addresses directories. The router used to reject any path with
    // an empty last segment, so the URL the client helper hands out 404'd
    // before it reached the plugin.
    const { harness, app } = await pypiHarness();
    await harness.repositoryObjectStore.putText(
      "repositories/python-public/simple/index.html",
      "<a href=\"my-project/\">my-project</a>",
      "text/html; charset=utf-8",
    );

    const response = await app.fetch(
      new Request("https://axis.example/repositories/python-public/simple/"),
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain("my-project");
  });

  it("answers a project page", async () => {
    const { harness, app } = await pypiHarness();
    await harness.repositoryObjectStore.putText(
      "repositories/python-public/simple/my-project/index.html",
      "<a href=\"../../packages/my-project/my_project-1.0-py3-none-any.whl#sha256=abc\">whl</a>",
      "text/html; charset=utf-8",
    );

    const response = await app.fetch(
      new Request("https://axis.example/repositories/python-public/simple/my-project/"),
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain("my_project-1.0-py3-none-any.whl");
  });

  it("serves the distribution a project page links to", async () => {
    const { harness, app } = await pypiHarness();
    await harness.repositoryObjectStore.putBytes(
      "repositories/python-public/packages/my-project/my_project-1.0-py3-none-any.whl",
      new TextEncoder().encode("wheel bytes"),
      "application/octet-stream",
    );

    const response = await app.fetch(
      new Request("https://axis.example/repositories/python-public/packages/my-project/my_project-1.0-py3-none-any.whl"),
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("wheel bytes");
  });

  it("still refuses a path with an empty segment in the middle", async () => {
    // Only one trailing slash is tolerated; anything else stays out.
    const { app } = await pypiHarness();

    const response = await app.fetch(
      new Request("https://axis.example/repositories/python-public/simple//my-project/"),
    );

    expect(response.status).toBe(404);
  });

  it("does not serve staged uploads", async () => {
    const { harness, app } = await pypiHarness();
    await harness.repositoryObjectStore.putText(
      "repositories/python-public/_staging/uploads/s/u/secret.whl",
      "not published",
      "application/octet-stream",
    );

    const response = await app.fetch(
      new Request("https://axis.example/repositories/python-public/_staging/uploads/s/u/secret.whl"),
    );

    expect(response.status).toBe(404);
  });
});

describe("concurrent publishes to one PyPI repository", () => {
  it("keeps both sessions' distributions on the project page", async () => {
    // Publishing merges into the page already published, so without ordering
    // the later write erases whatever the earlier one added. The write lock is
    // ecosystem-agnostic, and this pins that PyPI is behind it too.
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    await createRepository(app, {
      name: "python-internal",
      ecosystem: "pypi",
      visibility: "private",
      config: {},
    });
    const token = await createToken(app, {
      name: "pypi-token",
      repositories: ["python-internal"],
      permissions: ["publish"],
      ecosystemScopes: {},
    });

    async function prepare(version: string) {
      const bytes = await sdistBytes({ name: "alpha", version });
      const filename = `alpha-${version}.tar.gz`;
      const created = await app.fetch(new Request("https://axis.example/api/publish-sessions", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          repositoryName: "python-internal",
          ecosystem: "pypi",
          artifacts: [{
            filename,
            size: bytes.byteLength,
            sha256: await sha256Hex(bytes),
            contentType: "application/octet-stream",
            metadata: {},
          }],
        }),
      }));
      expect(created.status).toBe(201);
      const session = (await created.json()) as { id: string; uploads: Array<{ uploadId: string; objectKey: string }> };
      const upload = session.uploads[0]!;
      await harness.repositoryObjectStore.putBytes(upload.objectKey, bytes, "application/octet-stream");
      await app.fetch(new Request(
        `https://axis.example/api/publish-sessions/${session.id}/uploads/${upload.uploadId}/verify`,
        { method: "POST", headers: { authorization: `Bearer ${token}` } },
      ));
      return () => app.fetch(new Request(
        `https://axis.example/api/publish-sessions/${session.id}/finalize`,
        { method: "POST", headers: { authorization: `Bearer ${token}` } },
      ));
    }

    const finalizeOne = await prepare("1.0");
    const finalizeTwo = await prepare("2.0");

    // Every read yields to the event loop, so the two publishes really do
    // interleave over the page they both merge into. Without this the memory
    // store answers fast enough that one finishes before the other starts, and
    // the race the lock exists for never happens.
    const store = harness.repositoryObjectStore;
    const readObject = store.getObject.bind(store);
    store.getObject = async (key, options) => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      return readObject(key, options);
    };

    const responses = await Promise.all([finalizeOne(), finalizeTwo()]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const page = readStoredText(
      harness.repositoryObjectStore,
      "repositories/python-internal/simple/alpha/index.html",
    );
    expect(page).toContain("alpha-1.0.tar.gz");
    expect(page).toContain("alpha-2.0.tar.gz");
  });
});

describe("publishing a PyPI package the way twine does", () => {
  async function pypiUploadHarness() {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    await createRepository(app, {
      name: "python-internal",
      ecosystem: "pypi",
      visibility: "private",
      config: {},
    });
    const token = await createToken(app, {
      name: "pypi-token",
      repositories: ["python-internal"],
      permissions: ["publish"],
      ecosystemScopes: {},
    });
    return { harness, app, token };
  }

  /** The form twine posts: the distribution plus the fields describing it. */
  async function uploadForm(input: {
    filename: string;
    bytes: Uint8Array;
    declaredSha256?: string;
  }): Promise<FormData> {
    const form = new FormData();
    form.set(":action", "file_upload");
    form.set("protocol_version", "1");
    form.set("name", "alpha");
    form.set("version", "1.0");
    form.set("filetype", "sdist");
    form.set("metadata_version", "2.1");
    form.set("sha256_digest", input.declaredSha256 ?? await sha256Hex(input.bytes));
    form.set("content", new File([input.bytes], input.filename, { type: "application/octet-stream" }));
    return form;
  }

  function basic(token: string): string {
    return `Basic ${btoa(`__token__:${token}`)}`;
  }

  it("publishes a distribution from one request", async () => {
    const { harness, app, token } = await pypiUploadHarness();
    const bytes = await sdistBytes({ name: "alpha", version: "1.0" });

    const response = await app.fetch(new Request(
      "https://axis.example/repositories/python-internal/legacy/",
      {
        method: "POST",
        headers: { authorization: basic(token) },
        body: await uploadForm({ filename: "alpha-1.0.tar.gz", bytes }),
      },
    ));

    expect(response.status).toBe(200);
    await expect(harness.repositoryObjectStore.headObject(
      "repositories/python-internal/packages/alpha/alpha-1.0.tar.gz",
    )).resolves.not.toBeNull();
    expect(readStoredText(
      harness.repositoryObjectStore,
      "repositories/python-internal/simple/alpha/index.html",
    )).toContain("alpha-1.0.tar.gz");
  });

  it("publishes a wheel, whose metadata is read a different way", async () => {
    // An sdist is walked from the front as a gzip stream; a wheel is a zip,
    // read through its directory at the end. Uploading only ever exercised the
    // first, so nothing pinned that a streamed wheel could be read at all.
    const { harness, app, token } = await pypiUploadHarness();
    const bytes = wheelBytes({ name: "alpha", version: "1.0" });

    const response = await app.fetch(new Request(
      "https://axis.example/repositories/python-internal/legacy/",
      {
        method: "POST",
        headers: { authorization: basic(token) },
        body: await uploadForm({ filename: "alpha-1.0-py3-none-any.whl", bytes }),
      },
    ));

    expect(response.status).toBe(200);
    const page = readStoredText(
      harness.repositoryObjectStore,
      "repositories/python-internal/simple/alpha/index.html",
    );
    expect(page).toContain("alpha-1.0-py3-none-any.whl");
    // Read out of the wheel rather than off the request, so a page carrying it
    // means the zip was opened and its METADATA entry found.
    expect(page).toContain("data-core-metadata=");
    await expect(harness.repositoryObjectStore.headObject(
      "repositories/python-internal/packages/alpha/alpha-1.0-py3-none-any.whl.metadata",
    )).resolves.not.toBeNull();
  });

  it("refuses an upload with no credentials", async () => {
    const { app } = await pypiUploadHarness();
    const bytes = await sdistBytes({ name: "alpha", version: "1.0" });

    const response = await app.fetch(new Request(
      "https://axis.example/repositories/python-internal/legacy/",
      { method: "POST", body: await uploadForm({ filename: "alpha-1.0.tar.gz", bytes }) },
    ));

    expect(response.status).toBe(401);
  });

  it("refuses a token that cannot publish to this repository", async () => {
    const { app } = await pypiUploadHarness();
    const other = await createToken(app, {
      name: "elsewhere",
      repositories: ["somewhere-else"],
      permissions: ["publish"],
      ecosystemScopes: {},
    });
    const bytes = await sdistBytes({ name: "alpha", version: "1.0" });

    const response = await app.fetch(new Request(
      "https://axis.example/repositories/python-internal/legacy/",
      {
        method: "POST",
        headers: { authorization: basic(other) },
        body: await uploadForm({ filename: "alpha-1.0.tar.gz", bytes }),
      },
    ));

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });

  it("refuses an upload whose bytes do not match the digest it declared", async () => {
    // twine hashes before sending, so a mismatch means the bytes changed on
    // the way and must not be stored.
    const { app, token } = await pypiUploadHarness();
    const bytes = await sdistBytes({ name: "alpha", version: "1.0" });

    const response = await app.fetch(new Request(
      "https://axis.example/repositories/python-internal/legacy/",
      {
        method: "POST",
        headers: { authorization: basic(token) },
        body: await uploadForm({
          filename: "alpha-1.0.tar.gz",
          bytes,
          declaredSha256: "b".repeat(64),
        }),
      },
    ));

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toContain("sha256");
  });

  it("refuses a file that is not a distribution", async () => {
    const { app, token } = await pypiUploadHarness();

    const form = new FormData();
    form.set(":action", "file_upload");
    form.set("content", new File([new TextEncoder().encode("nope")], "notes.txt"));
    const response = await app.fetch(new Request(
      "https://axis.example/repositories/python-internal/legacy/",
      { method: "POST", headers: { authorization: basic(token) }, body: form },
    ));

    expect(response.status).toBe(400);
  });

  it("leaves the endpoint absent for ecosystems with no upload protocol", async () => {
    // apt has no such client, so nothing should answer there.
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    await createRepository(app, { name: "debian-internal", ecosystem: "apt", visibility: "private" });

    const response = await app.fetch(new Request(
      "https://axis.example/repositories/debian-internal/legacy/",
      { method: "POST", body: new FormData() },
    ));

    expect(response.status).toBe(404);
  });
});

describe("negotiating the PyPI Simple API", () => {
  async function published() {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    await createRepository(app, {
      name: "python-public",
      ecosystem: "pypi",
      visibility: "public",
      config: {},
    });
    await harness.repositoryObjectStore.putText(
      "repositories/python-public/simple/index.html",
      "<a href=\"alpha/\">alpha</a>",
      "text/html; charset=utf-8",
    );
    await harness.repositoryObjectStore.putText(
      "repositories/python-public/simple/index.v1.json",
      JSON.stringify({ meta: { "api-version": "1.0" }, projects: [{ name: "alpha" }] }),
      "application/vnd.pypi.simple.v1+json",
    );
    return { harness, app };
  }

  it("answers a Simple page itself even where objects are handed off", async () => {
    // pip resolves the links in a page against wherever that page came from.
    // Sent to storage, `../../packages/x.whl` resolves against the signed URL
    // and becomes an unsigned one the bucket refuses with a 400 — which is
    // what real pip hit. Only the files the page names are redirected.
    const { harness } = await published();
    const dependencies = {
      ...harness.dependencies,
      repositoryObjectDownloadSigner: {
        ttlSeconds: 300,
        sign: async (key: string) => `https://storage.example/${key}?signed=1`,
      },
    };
    const signing = createApp(dependencies);

    const page = await signing.fetch(
      new Request("https://axis.example/repositories/python-public/simple/"),
    );

    expect(page.status).toBe(200);
    await expect(page.text()).resolves.toContain("alpha");

    // The distribution itself is addressed directly and is handed off.
    await harness.repositoryObjectStore.putBytes(
      "repositories/python-public/packages/alpha/alpha-1.0.tar.gz",
      new TextEncoder().encode("sdist"),
      "application/octet-stream",
    );
    const file = await signing.fetch(
      new Request("https://axis.example/repositories/python-public/packages/alpha/alpha-1.0.tar.gz"),
    );

    expect(file.status).toBe(302);
    expect(file.headers.get("location")).toContain("signed=1");
  });

  it("answers with JSON when the client prefers it", async () => {
    // The Accept header pip actually sends.
    const { app } = await published();

    const response = await app.fetch(new Request(
      "https://axis.example/repositories/python-public/simple/",
      {
        headers: {
          accept: "application/vnd.pypi.simple.v1+json, application/vnd.pypi.simple.v1+html;q=0.2, text/html;q=0.01",
        },
      },
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/vnd.pypi.simple.v1+json");
    await expect(response.json()).resolves.toMatchObject({ projects: [{ name: "alpha" }] });
  });

  it("answers with HTML when the client asks for nothing in particular", async () => {
    const { app } = await published();

    const response = await app.fetch(
      new Request("https://axis.example/repositories/python-public/simple/"),
    );

    expect(response.headers.get("content-type")).toContain("text/html");
    await expect(response.text()).resolves.toContain("<a href=\"alpha/\">");
  });
});

describe("browsing a repository", () => {
  async function browsable(visibility: "public" | "private" = "public") {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    await createRepository(app, { name: "debian-internal", ecosystem: "apt", visibility });
    const put = (key: string, body: string) =>
      harness.repositoryObjectStore.putText(`repositories/debian-internal/${key}`, body, "text/plain");
    await put("dists/noble/InRelease", "signed");
    await put("dists/noble/main/binary-amd64/Packages", "Package: alpha\n");
    await put("pool/main/alpha/alpha_1.0.0_amd64.deb", "deb bytes");
    // Not something the apt plugin serves, so it must not appear anywhere.
    await put("publishes/session.json", "{}");
    return { harness, app };
  }

  it("answers the repository root with a listing instead of a JSON 404", async () => {
    // Opening a repository in a browser used to give an error document for
    // every path that was not a file.
    const { app } = await browsable();

    const response = await app.fetch(new Request("https://axis.example/repositories/debian-internal/"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const body = await response.text();
    expect(body).toContain(">dists/<");
    expect(body).toContain(">pool/<");
  });

  it("lists a directory further down", async () => {
    const { app } = await browsable();

    const response = await app.fetch(
      new Request("https://axis.example/repositories/debian-internal/dists/noble/"),
    );

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain(">InRelease<");
    expect(body).toContain(">main/<");
  });

  it("shows nothing the plugin would not serve", async () => {
    // A listing that showed more than the serving rule allows would be a way
    // around it: the entries are links, and a link nobody can follow is at
    // best noise and at worst a disclosure.
    const { app } = await browsable();

    const root = await (await app.fetch(
      new Request("https://axis.example/repositories/debian-internal/"),
    )).text();

    expect(root).not.toContain("publishes");
    const denied = await app.fetch(
      new Request("https://axis.example/repositories/debian-internal/publishes/"),
    );
    expect(denied.status).toBe(404);
  });

  it.each([
    ["the repository root", "/repositories/debian-internal", "/repositories/debian-internal/"],
    ["a directory below it", "/repositories/debian-internal/dists", "/repositories/debian-internal/dists/"],
  ])("redirects %s when asked for without its trailing slash", async (_case, from, to) => {
    // The links in a listing are relative to it, so serving one at the
    // slashless path resolves every link a level too high: a listing at
    // /repositories/a would link to /repositories/Packages.
    const { app } = await browsable();

    const at = `https://axis.example${from}`;
    const response = await app.fetch(new Request(at, { redirect: "manual" }));

    expect(response.status).toBe(301);
    // Asserted as the client resolves it: the Location is a relative
    // reference so it survives a prefix the worker cannot see.
    expect(new URL(response.headers.get("location")!, at).pathname).toBe(to);
  });

  it("resolves a listing's links against the directory it is served at", async () => {
    // The property the redirect exists to protect, stated directly.
    const { app } = await browsable();
    const at = "https://axis.example/repositories/debian-internal/dists/noble/";

    const body = await (await app.fetch(new Request(at))).text();
    // Entry links only; the breadcrumb and the parent row deliberately go up.
    const hrefs = [...body.matchAll(/<tr(?![^>]*data-up)[^>]*>([\s\S]*?)<\/tr>/g)]
      .flatMap((row) => [...row[1]!.matchAll(/href="([^"]+)"/g)].map((match) => match[1]!));

    expect(hrefs.map((href) => new URL(href, at).pathname))
      .toContain("/repositories/debian-internal/dists/noble/InRelease");
    for (const href of hrefs) {
      expect(new URL(href, at).href.startsWith(at)).toBe(true);
    }
  });

  it("redirects so a prefix the worker cannot see survives", async () => {
    // A reverse proxy mapping /mirror/… onto the worker sends a path the
    // worker never learns about; an absolute Location would drop it.
    const { app } = await browsable();
    const behindProxy = "https://axis.example/mirror/repositories/debian-internal";

    const response = await app.fetch(
      new Request("https://axis.example/repositories/debian-internal", { redirect: "manual" }),
    );

    expect(new URL(response.headers.get("location")!, behindProxy).pathname)
      .toBe("/mirror/repositories/debian-internal/");
  });

  it("still serves a file rather than listing it", async () => {
    const { app } = await browsable();

    const response = await app.fetch(
      new Request("https://axis.example/repositories/debian-internal/dists/noble/InRelease"),
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("signed");
  });

  it("answers 404 for a directory nothing was published under", async () => {
    const { app } = await browsable();

    const response = await app.fetch(
      new Request("https://axis.example/repositories/debian-internal/dists/jammy/"),
    );

    expect(response.status).toBe(404);
  });

  it("refuses to list a private repository without a token", async () => {
    // Browsing must not become a way to read a private repository's contents.
    const { app } = await browsable("private");

    const response = await app.fetch(new Request("https://axis.example/repositories/debian-internal/"));

    expect(response.status).toBe(401);
  });
});

describe("uploading a distribution larger than the worker heap", () => {
  /**
   * Builds a multipart body without holding the distribution, so the test
   * itself is not the thing that runs out of memory.
   */
  function twineBody(input: { filename: string; sizeBytes: number; boundary: string; onChunk?: () => void }) {
    const head = new TextEncoder().encode(
      `--${input.boundary}\r\n`
      + "content-disposition: form-data; name=\":action\"\r\n\r\nfile_upload\r\n"
      + `--${input.boundary}\r\n`
      + `content-disposition: form-data; name="content"; filename="${input.filename}"\r\n`
      + "content-type: application/octet-stream\r\n\r\n",
    );
    const tail = new TextEncoder().encode(`\r\n--${input.boundary}--\r\n`);
    const chunk = new Uint8Array(64 * 1024);
    let remaining = input.sizeBytes;
    let stage = 0;

    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (stage === 0) { controller.enqueue(head); stage = 1; return; }
        if (remaining > 0) {
          const take = Math.min(remaining, chunk.byteLength);
          remaining -= take;
          input.onChunk?.();
          controller.enqueue(chunk.subarray(0, take));
          return;
        }
        if (stage === 1) { controller.enqueue(tail); stage = 2; return; }
        controller.close();
      },
    });
  }

  async function pypiHarness() {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    await createRepository(app, {
      name: "python-internal",
      ecosystem: "pypi",
      visibility: "private",
      config: {},
    });
    const token = await createToken(app, {
      name: "pypi-token",
      repositories: ["python-internal"],
      permissions: ["publish"],
      ecosystemScopes: {},
    });
    return { harness, app, token };
  }

  it("never holds more than one part of it", async () => {
    // The property the whole streaming path exists for. Before this, the
    // runtime materialized the part and a wheel past the heap could not be
    // published with twine at all.
    const { harness, app, token } = await pypiHarness();
    const boundary = "axis-test-boundary";
    // Streaming means storage starts receiving while the body is still
    // arriving. Buffering cannot: it has to read the last chunk of the
    // distribution before it can hand over the first.
    let chunksRead = 0;
    let chunksReadAtFirstWrite = -1;
    const store = harness.repositoryObjectStore;
    const createPartWriter = store.createPartWriter.bind(store);
    store.createPartWriter = async (key, contentType) => {
      const writer = await createPartWriter(key, contentType);
      return {
        ...writer,
        write: async (chunk) => {
          if (chunksReadAtFirstWrite === -1) {
            chunksReadAtFirstWrite = chunksRead;
          }
          return writer.write(chunk);
        },
      };
    };

    const sizeBytes = 8 * 1024 * 1024;
    const totalChunks = sizeBytes / (64 * 1024);
    const response = await app.fetch(new Request(
      "https://axis.example/repositories/python-internal/legacy/",
      {
        method: "POST",
        headers: {
          authorization: `Basic ${btoa(`__token__:${token}`)}`,
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        body: twineBody({
          filename: "alpha-1.0.tar.gz",
          sizeBytes,
          boundary,
          onChunk: () => { chunksRead += 1; },
        }),
        // @ts-expect-error duplex is required for a streamed request body
        duplex: "half",
      },
    ));

    // Rejected for its contents, not its size: an 8 MiB run of zeroes is not a
    // source distribution. Reaching that verdict at all means the whole body
    // streamed through — and a bad upload is a bad request, not a fault here.
    expect(response.status).toBe(400);
    expect(chunksReadAtFirstWrite).toBeGreaterThanOrEqual(0);
    expect(chunksReadAtFirstWrite).toBeLessThan(totalChunks / 4);
  });
});

describe("deleting a published PyPI distribution", () => {
  async function publish(
    app: ReturnType<typeof createApp>,
    token: string,
    version: string,
  ): Promise<void> {
    const bytes = await sdistBytes({ name: "alpha", version });
    const form = new FormData();
    form.set(":action", "file_upload");
    form.set("sha256_digest", await sha256Hex(bytes));
    form.set(
      "content",
      new File([bytes], `alpha-${version}.tar.gz`, { type: "application/octet-stream" }),
    );
    const response = await app.fetch(new Request(
      "https://axis.example/repositories/python-internal/legacy/",
      {
        method: "POST",
        headers: { authorization: `Basic ${btoa(`__token__:${token}`)}` },
        body: form,
      },
    ));
    expect(response.status).toBe(200);
  }

  it("stops offering the release to pip", async () => {
    // Deleting removed the file and left the project page listing it, so pip
    // resolved against a release it then could not download. A page that
    // offers a 404 is worse than one that never mentioned the release.
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    await createRepository(app, {
      name: "python-internal",
      ecosystem: "pypi",
      visibility: "public",
      config: {},
    });
    const token = await createToken(app, {
      name: "pypi-token",
      repositories: ["python-internal"],
      permissions: ["publish"],
      ecosystemScopes: {},
    });
    await publish(app, token, "1.0");
    await publish(app, token, "2.0");

    const listed = await app.fetch(new Request(
      "https://axis.example/admin/repositories/python-internal/artifacts",
      { headers: { authorization: "Bearer dev-admin-token" } },
    ));
    const { artifacts } = await listed.json() as { artifacts: Array<{ id: string; objectKeys: string[] }> };
    const target = artifacts.find((artifact) => artifact.objectKeys.some((key) => key.includes("alpha-1.0")))!;

    const deleted = await app.fetch(new Request(
      `https://axis.example/admin/repositories/python-internal/artifacts/${encodeURIComponent(target.id)}`,
      { method: "DELETE", headers: { authorization: "Bearer dev-admin-token" } },
    ));
    expect(deleted.status).toBe(200);

    const page = await app.fetch(new Request(
      "https://axis.example/repositories/python-internal/simple/alpha/",
    ));
    const html = await page.text();
    expect(html).not.toContain("alpha-1.0.tar.gz");
    expect(html).toContain("alpha-2.0.tar.gz");

    // The core metadata published beside it goes too, rather than being served
    // forever with nothing pointing at it.
    const metadata = await app.fetch(new Request(
      "https://axis.example/repositories/python-internal/packages/alpha/alpha-1.0.tar.gz.metadata",
    ));
    expect(metadata.status).toBe(404);
  });
});
