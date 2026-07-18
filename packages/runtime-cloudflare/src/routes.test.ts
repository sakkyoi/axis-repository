import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
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
    new Request("https://axis.example/admin/signing-keys", {
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

describe("Cloudflare runtime routes", () => {
  it("responds to health checks", async () => {
    const app = createApp();
    const response = await app.fetch(new Request("https://axis.example/health"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, service: "axis-repository" });
  });

  it("returns not found for unknown routes", async () => {
    const app = createApp();
    const response = await app.fetch(new Request("https://axis.example/missing"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "not_found", message: "Not Found" },
    });
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
          config: { codenames: ["noble"] },
        }),
      }),
    );

    expect(createResponse.status).toBe(201);
    await expect(createResponse.json()).resolves.toMatchObject({
      name: "debian-internal",
      ecosystem: "apt",
      visibility: "private",
      config: { codenames: ["noble"] },
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

  it("creates a publish token and starts a publish session", async () => {
    const app = createApp();

    await app.fetch(
      new Request("https://axis.example/admin/repositories", {
        method: "POST",
        headers: {
          authorization: "Bearer dev-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "debian-internal", ecosystem: "apt" }),
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
              metadata: {},
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

  it("verifies an uploaded artifact for a publish session", async () => {
    const app = createApp();

    await app.fetch(
      new Request("https://axis.example/admin/repositories", {
        method: "POST",
        headers: {
          authorization: "Bearer dev-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "debian-internal", ecosystem: "apt" }),
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
              metadata: {},
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

  it("finalizes a verified publish session", async () => {
    const harness = createDevDependencyHarness();
    const app = createApp(harness.dependencies);
    const { token, session } = await createPublishSession(app, harness.repositoryObjectStore);
    const upload = session.uploads[0];
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
      new Request("https://axis.example/admin/signing-keys", {
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

  it("fails closed when finalizing a repository with no registered publisher", async () => {
    const app = createApp();

    await app.fetch(
      new Request("https://axis.example/admin/repositories", {
        method: "POST",
        headers: {
          authorization: "Bearer dev-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "python-internal", ecosystem: "pypi" }),
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
          repositories: ["python-internal"],
          permissions: ["publish"],
          ecosystemScopes: {},
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
          repositoryName: "python-internal",
          ecosystem: "pypi",
          artifacts: [
            {
              filename: "example-1.0.0.tar.gz",
              size: 1234,
              sha256: "b".repeat(64),
              contentType: "application/gzip",
              metadata: {},
            },
          ],
        }),
      }),
    );
    expect(sessionResponse.status).toBe(201);
    const session = (await sessionResponse.json()) as {
      id: string;
      uploads: Array<{ uploadId: string }>;
    };
    const upload = session.uploads[0];
    if (!upload) {
      throw new Error("Expected publish session to include an upload target");
    }

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
        message: "Artifact publisher is not configured for ecosystem: pypi",
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

  it("creates, lists, and revokes signing keys through admin routes", async () => {
    const { generateKey } = await import("openpgp");
    const key = await generateKey({
      type: "ecc",
      curve: "curve25519Legacy",
      userIDs: [{ name: "Axis Test", email: "axis@example.test" }],
      passphrase: "correct-passphrase",
    });
    const app = createApp();

    const createResponse = await app.fetch(
      new Request("https://axis.example/admin/signing-keys", {
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
    expect(created).not.toHaveProperty("privateKeyArmored");
    expect(created).not.toHaveProperty("passphrase");
    expect(created).not.toHaveProperty("encryptedPrivateKeyArmored");
    expect(created).not.toHaveProperty("encryptedPassphrase");

    const listResponse = await app.fetch(
      new Request("https://axis.example/admin/signing-keys", {
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

    const revokeResponse = await app.fetch(
      new Request(`https://axis.example/admin/signing-keys/${created.id}/revoke`, {
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
  });

  it("requires admin auth for signing key revoke paths before method dispatch", async () => {
    const app = createApp();

    const response = await app.fetch(
      new Request("https://axis.example/admin/signing-keys/signing_key_missing/revoke"),
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
        body: JSON.stringify({ name: "debian-internal", ecosystem: "apt" }),
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
        body: JSON.stringify({ name: "debian-internal", ecosystem: "apt" }),
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
