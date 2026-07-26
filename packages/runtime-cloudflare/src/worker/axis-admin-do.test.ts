import { describe, expect, it } from "vitest";
import { AxisAdminDO, type AxisEnv } from "./axis-admin-do";
import { debArchive } from "@axis-repository/plugin-apt/test-support";
import type { DurableStorage } from "../storage/durable-state";

class FakeDurableStorage implements DurableStorage {
  readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<boolean> {
    return this.values.delete(key);
  }

  async list<T>(options?: { prefix?: string }): Promise<Map<string, T>> {
    const result = new Map<string, T>();
    for (const [key, value] of this.values) {
      if (!options?.prefix || key.startsWith(options.prefix)) {
        result.set(key, value as T);
      }
    }
    return result;
  }
}

class FakeR2Bucket {
  readonly objects = new Map<string, {
    value: string | Uint8Array;
    contentType?: string;
    customMetadata?: Record<string, string>;
  }>();

  seedUpload(key: string, value: Uint8Array, options: { contentType: string; size: number; sha256: string; uploadId: string }) {
    if (value.byteLength !== options.size) {
      throw new Error(`Seeded upload size mismatch for ${key}`);
    }
    this.objects.set(key, {
      value: new Uint8Array(value),
      contentType: options.contentType,
      customMetadata: {
        "axis-sha256": options.sha256,
        "axis-upload-id": options.uploadId,
      },
    });
  }

  async head(key: string): Promise<{
    httpMetadata?: { contentType?: string };
    etag?: string;
    httpEtag?: string;
    size: number;
    customMetadata?: Record<string, string>;
  } | null> {
    const object = this.objects.get(key);
    if (!object) {
      return null;
    }
    const bytes = object.value instanceof Uint8Array ? object.value : new TextEncoder().encode(object.value);
    return {
      ...(object.contentType ? { httpMetadata: { contentType: object.contentType } } : {}),
      etag: `fake-${bytes.byteLength}`,
      httpEtag: `"fake-${bytes.byteLength}"`,
      size: bytes.byteLength,
      ...(object.customMetadata ? { customMetadata: object.customMetadata } : {}),
    };
  }

  async get(key: string, options?: { range?: { offset: number; length: number } }): Promise<{
    httpMetadata?: { contentType?: string };
    etag?: string;
    httpEtag?: string;
    size?: number;
    arrayBuffer(): Promise<ArrayBuffer>;
  } | null> {
    const object = this.objects.get(key);
    if (!object) {
      return null;
    }
    const bytes = object.value instanceof Uint8Array ? object.value : new TextEncoder().encode(object.value);
    const bodyBytes = options?.range
      ? bytes.slice(options.range.offset, options.range.offset + options.range.length)
      : bytes;
    return {
      ...(object.contentType ? { httpMetadata: { contentType: object.contentType } } : {}),
      etag: `fake-${bytes.byteLength}`,
      httpEtag: `"fake-${bytes.byteLength}"`,
      size: bytes.byteLength,
      arrayBuffer: async () => toArrayBuffer(bodyBytes),
    };
  }

  async list(options?: { prefix?: string; delimiter?: string; cursor?: string; limit?: number }): Promise<{
    objects: Array<{ key: string; size: number; httpMetadata?: { contentType?: string }; httpEtag?: string }>;
    delimitedPrefixes: string[];
    truncated: boolean;
  }> {
    const prefix = options?.prefix ?? "";
    const delimitedPrefixes = new Set<string>();
    const objects: Array<{ key: string; size: number; httpMetadata?: { contentType?: string }; httpEtag?: string }> = [];

    for (const [key, object] of [...this.objects].sort(([left], [right]) => left.localeCompare(right))) {
      if (!key.startsWith(prefix)) {
        continue;
      }
      const rest = key.slice(prefix.length);
      const delimiterIndex = options?.delimiter ? rest.indexOf(options.delimiter) : -1;
      if (options?.delimiter && delimiterIndex >= 0) {
        delimitedPrefixes.add(`${prefix}${rest.slice(0, delimiterIndex + options.delimiter.length)}`);
        continue;
      }
      const bytes = object.value instanceof Uint8Array ? object.value : new TextEncoder().encode(object.value);
      objects.push({
        key,
        size: bytes.byteLength,
        ...(object.contentType ? { httpMetadata: { contentType: object.contentType } } : {}),
        httpEtag: `"fake-${bytes.byteLength}"`,
      });
    }

    return { objects, delimitedPrefixes: [...delimitedPrefixes], truncated: false };
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async put(
    key: string,
    value: string | Uint8Array | ReadableStream,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<void> {
    if (value instanceof ReadableStream) {
      const response = new Response(value);
      this.objects.set(key, {
        value: new Uint8Array(await response.arrayBuffer()),
        ...(options?.httpMetadata?.contentType ? { contentType: options.httpMetadata.contentType } : {}),
      });
      return;
    }
    this.objects.set(key, {
      value: typeof value === "string" ? value : new Uint8Array(value),
      ...(options?.httpMetadata?.contentType ? { contentType: options.httpMetadata.contentType } : {}),
    });
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function readBucketText(bucket: FakeR2Bucket, key: string): string {
  const object = bucket.objects.get(key);
  if (!object) {
    throw new Error(`Expected stored R2 object: ${key}`);
  }
  if (typeof object.value !== "string") {
    throw new Error(`Expected stored R2 text object: ${key}`);
  }
  return object.value;
}

function readBucketBytes(bucket: FakeR2Bucket, key: string): Uint8Array {
  const object = bucket.objects.get(key);
  if (!object) {
    throw new Error(`Expected stored R2 object: ${key}`);
  }
  if (!(object.value instanceof Uint8Array)) {
    throw new Error(`Expected stored R2 byte object: ${key}`);
  }
  return object.value;
}

function aptDebFixture(): Uint8Array {
  return debArchive({
    control: [
      "Package: myapp",
      "Version: 1.2.3",
      "Architecture: amd64",
      "Maintainer: Release Team <release@example.com>",
      "Description: Example package",
      "Section: main",
    ].join("\n"),
  });
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

function basicAuth(secret: string, username = "axis"): string {
  return `Basic ${btoa(`${username}:${secret}`)}`;
}

type TestAxisEnv = {
  AXIS_ADMIN?: DurableObjectNamespace | undefined;
  AXIS_OBJECTS?: R2Bucket | undefined;
  AXIS_ADMIN_USERNAME?: string | undefined;
  AXIS_ADMIN_PASSWORD_HASH?: string | undefined;
  AXIS_ADMIN_PASSWORD?: string | undefined;
  AXIS_SESSION_SECRET?: string | undefined;
  TOKEN_HASH_PEPPER?: string | undefined;
  SIGNING_KEY_ENCRYPTION_SECRET?: string | undefined;
  R2_ACCOUNT_ID?: string | undefined;
  R2_BUCKET_NAME?: string | undefined;
  R2_ACCESS_KEY_ID?: string | undefined;
  R2_SECRET_ACCESS_KEY?: string | undefined;
  UPLOAD_URL_TTL_SECONDS?: string | undefined;
  UPLOAD_BACKEND?: string | undefined;
  AXIS_ARTIFACT_ORIGIN?: string | undefined;
};

function createObject(env: TestAxisEnv = {}, storage: FakeDurableStorage = new FakeDurableStorage()) {
  return new AxisAdminDO({ storage } as unknown as DurableObjectState, {
    AXIS_OBJECTS: new FakeR2Bucket() as unknown as R2Bucket,
    AXIS_ADMIN_USERNAME: "admin",
    AXIS_ADMIN_PASSWORD: "admin-password",
    AXIS_SESSION_SECRET: "test-session-secret",
    TOKEN_HASH_PEPPER: "pepper",
    SIGNING_KEY_ENCRYPTION_SECRET: "local-signing-secret",
    R2_ACCOUNT_ID: "account123",
    R2_BUCKET_NAME: "axis-repository",
    R2_ACCESS_KEY_ID: "access",
    R2_SECRET_ACCESS_KEY: "secret",
    ...env,
  } as AxisEnv);
}

async function adminAuthorizationHeader(object: AxisAdminDO): Promise<string> {
  const response = await object.fetch(
    new Request("https://axis.example/admin/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin-password" }),
    }),
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as { accessToken: string };
  return `Bearer ${body.accessToken}`;
}

describe("AxisAdminDO", () => {
  it("rejects an AXIS_ARTIFACT_ORIGIN that is not a bare origin", () => {
    for (const value of [
      "cdn.axis.example",
      "https://cdn.axis.example/artifacts",
      "https://cdn.axis.example/?x=1",
      "https://cdn.axis.example/#frag",
      "ftp://cdn.axis.example",
      "not a url",
    ]) {
      // A path or query here would silently produce broken sources.list lines.
      expect(
        () => createObject({ AXIS_ARTIFACT_ORIGIN: value }),
        value,
      ).toThrow(/AXIS_ARTIFACT_ORIGIN/);
    }
  });

  it("accepts a bare artifact origin and normalizes it", () => {
    expect(() => createObject({ AXIS_ARTIFACT_ORIGIN: "https://cdn.axis.example/" })).not.toThrow();
  });


  it("allows bootstrap credentials to be removed after the owner user is seeded", async () => {
    const storage = new FakeDurableStorage();
    const object = createObject({}, storage);
    const adminAuthorization = await adminAuthorizationHeader(object);

    const reseededObject = createObject({
      AXIS_ADMIN_USERNAME: undefined,
      AXIS_ADMIN_PASSWORD: undefined,
      AXIS_ADMIN_PASSWORD_HASH: undefined,
    }, storage);
    const response = await reseededObject.fetch(
      new Request("https://axis.example/admin/users", {
        headers: { authorization: adminAuthorization },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      users: [expect.objectContaining({ username: "admin", role: "owner" })],
      canCreateUsers: false,
    });
  });

  it("rejects bootstrap login when no owner user or bootstrap credentials are available", async () => {
    const object = createObject({
      AXIS_ADMIN_USERNAME: undefined,
      AXIS_ADMIN_PASSWORD: undefined,
      AXIS_ADMIN_PASSWORD_HASH: undefined,
    });
    const response = await object.fetch(new Request("https://axis.example/admin/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin-password" }),
    }));

    expect(response.status).toBe(401);
  });

  it("requires an admin session secret", () => {
    expect(() => createObject({ AXIS_SESSION_SECRET: undefined })).toThrow(
      "AXIS_SESSION_SECRET is required for AxisAdminDO",
    );
    expect(() => createObject({ AXIS_SESSION_SECRET: "" })).toThrow(
      "AXIS_SESSION_SECRET is required for AxisAdminDO",
    );
  });

  it("requires a token hash pepper", () => {
    expect(() => createObject({ TOKEN_HASH_PEPPER: undefined })).toThrow(
      "TOKEN_HASH_PEPPER is required for AxisAdminDO",
    );
    expect(() => createObject({ TOKEN_HASH_PEPPER: "" })).toThrow(
      "TOKEN_HASH_PEPPER is required for AxisAdminDO",
    );
  });

  it("requires a signing key encryption secret", () => {
    expect(() => createObject({ SIGNING_KEY_ENCRYPTION_SECRET: undefined })).toThrow(
      "SIGNING_KEY_ENCRYPTION_SECRET is required for AxisAdminDO",
    );
    expect(() => createObject({ SIGNING_KEY_ENCRYPTION_SECRET: "" })).toThrow(
      "SIGNING_KEY_ENCRYPTION_SECRET is required for AxisAdminDO",
    );
  });

  it("requires an R2 bucket binding", () => {
    expect(() => createObject({ AXIS_OBJECTS: undefined })).toThrow(
      "AXIS_OBJECTS is required for AxisAdminDO",
    );
  });

  it("requires R2 signing configuration", () => {
    expect(() => createObject({ R2_ACCOUNT_ID: undefined })).toThrow(
      "R2_ACCOUNT_ID is required for AxisAdminDO",
    );
    expect(() => createObject({ R2_BUCKET_NAME: undefined })).toThrow(
      "R2_BUCKET_NAME is required for AxisAdminDO",
    );
    expect(() => createObject({ R2_ACCESS_KEY_ID: undefined })).toThrow(
      "R2_ACCESS_KEY_ID is required for AxisAdminDO",
    );
    expect(() => createObject({ R2_SECRET_ACCESS_KEY: undefined })).toThrow(
      "R2_SECRET_ACCESS_KEY is required for AxisAdminDO",
    );
  });

  it("uses r2 upload backend by default", () => {
    expect(() => createObject({ R2_ACCOUNT_ID: undefined })).toThrow(
      "R2_ACCOUNT_ID is required for AxisAdminDO",
    );
  });

  it("uses r2 upload backend when configured as an empty string", () => {
    expect(() => createObject({ UPLOAD_BACKEND: "", R2_BUCKET_NAME: undefined })).toThrow(
      "R2_BUCKET_NAME is required for AxisAdminDO",
    );
  });

  it("uses r2 upload backend when explicitly configured", () => {
    expect(() => createObject({ UPLOAD_BACKEND: "r2", R2_ACCESS_KEY_ID: undefined })).toThrow(
      "R2_ACCESS_KEY_ID is required for AxisAdminDO",
    );
  });

  it("uses memory upload backend without R2 env", async () => {
    const object = createObject({
      UPLOAD_BACKEND: "memory",
      AXIS_OBJECTS: undefined,
      R2_ACCOUNT_ID: undefined,
      R2_BUCKET_NAME: undefined,
      R2_ACCESS_KEY_ID: undefined,
      R2_SECRET_ACCESS_KEY: undefined,
    });
    const adminAuthorization = await adminAuthorizationHeader(object);

    const response = await object.fetch(
      new Request("https://axis.example/admin/repositories", {
        method: "POST",
        headers: {
          authorization: adminAuthorization,
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "debian-internal", ecosystem: "apt", config: validAptConfig() }),
      }),
    );

    expect(response.status).toBe(201);
  });

  it("uses local R2 upload backend without R2 signing configuration", async () => {
    const object = createObject({
      UPLOAD_BACKEND: "local-r2",
      R2_ACCOUNT_ID: undefined,
      R2_BUCKET_NAME: undefined,
      R2_ACCESS_KEY_ID: undefined,
      R2_SECRET_ACCESS_KEY: undefined,
    });
    const adminAuthorization = await adminAuthorizationHeader(object);

    const response = await object.fetch(
      new Request("https://axis.example/admin/repositories", {
        method: "POST",
        headers: {
          authorization: adminAuthorization,
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "debian-internal", ecosystem: "apt", config: validAptConfig() }),
      }),
    );

    expect(response.status).toBe(201);
  });

  it("serves hardened admin APIs through the Durable Object", async () => {
    const { generateKey } = await import("openpgp");
    const key = await generateKey({
      type: "ecc",
      curve: "curve25519Legacy",
      userIDs: [{ name: "Axis Test", email: "axis@example.test" }],
      passphrase: "correct-passphrase",
    });
    const object = createObject();
    const adminAuthorization = await adminAuthorizationHeader(object);

    const createSigningKey = await object.fetch(
      new Request("https://axis.example/admin/repositories/debian-internal/apt/signing-keys/import", {
        method: "POST",
        headers: {
          authorization: adminAuthorization,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "debian-prod",
          privateKeyArmored: key.privateKey,
          passphrase: "correct-passphrase",
        }),
      }),
    );
    expect(createSigningKey.status).toBe(201);
    const signingKey = (await createSigningKey.json()) as { id: string };

    const createRepository = await object.fetch(
      new Request("https://axis.example/admin/repositories", {
        method: "POST",
        headers: {
          authorization: adminAuthorization,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "debian-internal",
          ecosystem: "apt",
          config: validAptConfig(signingKey.id),
        }),
      }),
    );
    expect(createRepository.status).toBe(201);

    const repositoryDetail = await object.fetch(
      new Request("https://axis.example/admin/repositories/debian-internal", {
        headers: { authorization: adminAuthorization },
      }),
    );
    expect(repositoryDetail.status).toBe(200);
    await expect(repositoryDetail.json()).resolves.toMatchObject({
      name: "debian-internal",
      ecosystem: "apt",
      visibility: "private",
    });

    const repositoryUpdate = await object.fetch(
      new Request("https://axis.example/admin/repositories/debian-internal", {
        method: "PATCH",
        headers: {
          authorization: adminAuthorization,
          "content-type": "application/json",
        },
        body: JSON.stringify({ visibility: "public" }),
      }),
    );
    expect(repositoryUpdate.status).toBe(200);
    await expect(repositoryUpdate.json()).resolves.toMatchObject({
      name: "debian-internal",
      visibility: "public",
    });

    const createToken = await object.fetch(
      new Request("https://axis.example/admin/publish-tokens", {
        method: "POST",
        headers: {
          authorization: adminAuthorization,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "github-actions",
          repositories: ["debian-internal"],
          permissions: ["publish"],
          ecosystemScopes: {},
          signingKeyIds: [signingKey.id],
        }),
      }),
    );
    expect(createToken.status).toBe(201);
    const tokenBody = (await createToken.json()) as { secret: string };

    const tokenDetail = await object.fetch(
      new Request("https://axis.example/admin/publish-tokens/github-actions", {
        headers: { authorization: adminAuthorization },
      }),
    );
    expect(tokenDetail.status).toBe(200);
    const tokenDetailBody = (await tokenDetail.json()) as Record<string, unknown>;
    expect(tokenDetailBody).toMatchObject({ name: "github-actions" });
    expect(tokenDetailBody).not.toHaveProperty("tokenHash");
    expect(JSON.stringify(tokenDetailBody)).not.toContain(tokenBody.secret);

    const revokeToken = await object.fetch(
      new Request("https://axis.example/admin/publish-tokens/github-actions/revoke", {
        method: "POST",
        headers: { authorization: adminAuthorization },
      }),
    );
    expect(revokeToken.status).toBe(200);
    await expect(revokeToken.json()).resolves.toMatchObject({
      name: "github-actions",
      revokedAt: expect.any(String),
    });

    const signingKeyDetail = await object.fetch(
      new Request(`https://axis.example/admin/repositories/debian-internal/apt/signing-keys/${signingKey.id}`, {
        headers: { authorization: adminAuthorization },
      }),
    );
    expect(signingKeyDetail.status).toBe(200);
    const signingKeyDetailBody = (await signingKeyDetail.json()) as Record<string, unknown>;
    expect(signingKeyDetailBody).toMatchObject({ id: signingKey.id, name: "debian-prod" });
    expect(signingKeyDetailBody).not.toHaveProperty("privateKeyArmored");
    expect(signingKeyDetailBody).not.toHaveProperty("passphrase");
    expect(signingKeyDetailBody).not.toHaveProperty("encryptedPrivateKeyArmored");
    expect(signingKeyDetailBody).not.toHaveProperty("encryptedPassphrase");
  });

  it("finalizes publish sessions through the Durable Object R2 path", async () => {
    const { generateKey } = await import("openpgp");
    const key = await generateKey({
      type: "ecc",
      curve: "curve25519Legacy",
      userIDs: [{ name: "Axis Test", email: "axis@example.test" }],
      passphrase: "correct-passphrase",
    });
    const bucket = new FakeR2Bucket();
    const debBytes = aptDebFixture();
    const object = createObject({
      AXIS_OBJECTS: bucket as unknown as R2Bucket,
    });
    const adminAuthorization = await adminAuthorizationHeader(object);

    const createSigningKey = await object.fetch(
      new Request("https://axis.example/admin/repositories/debian-internal/apt/signing-keys/import", {
        method: "POST",
        headers: {
          authorization: adminAuthorization,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "debian-prod",
          privateKeyArmored: key.privateKey,
          passphrase: "correct-passphrase",
        }),
      }),
    );
    expect(createSigningKey.status).toBe(201);
    const signingKey = (await createSigningKey.json()) as { id: string };

    const createRepository = await object.fetch(
      new Request("https://axis.example/admin/repositories", {
        method: "POST",
        headers: {
          authorization: adminAuthorization,
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
    expect(createRepository.status).toBe(201);

    const createToken = await object.fetch(
      new Request("https://axis.example/admin/publish-tokens", {
        method: "POST",
        headers: {
          authorization: adminAuthorization,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "github-actions",
          repositories: ["debian-internal"],
          permissions: ["read", "publish"],
          ecosystemScopes: { apt: { allowedPackages: ["myapp"] } },
          signingKeyIds: [signingKey.id],
        }),
      }),
    );
    expect(createToken.status).toBe(201);
    const tokenBody = (await createToken.json()) as { secret: string };

    const createSession = await object.fetch(
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
    expect(createSession.status).toBe(201);
    const session = (await createSession.json()) as {
      id: string;
      uploads: Array<{ uploadId: string; objectKey: string }>;
    };
    const upload = session.uploads[0]!;
    if (!upload) {
      throw new Error("Expected publish session to include an upload target");
    }
    bucket.seedUpload(
      upload.objectKey,
      debBytes,
      {
        contentType: "application/vnd.debian.binary-package",
        size: debBytes.byteLength,
        sha256: "a".repeat(64),
        uploadId: upload.uploadId,
      },
    );

    const verify = await object.fetch(
      new Request(
        `https://axis.example/api/publish-sessions/${session.id}/uploads/${upload.uploadId}/verify`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${tokenBody.secret}` },
        },
      ),
    );
    expect(verify.status).toBe(200);

    const finalize = await object.fetch(
      new Request(`https://axis.example/api/publish-sessions/${session.id}/finalize`, {
        method: "POST",
        headers: { authorization: `Bearer ${tokenBody.secret}` },
      }),
    );

    expect(finalize.status).toBe(200);
    await expect(finalize.json()).resolves.toMatchObject({
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
      result: {
        objects: [
          { key: "repositories/debian-internal/pool/main/myapp/myapp_1.2.3_amd64.deb" },
          { key: "repositories/debian-internal/dists/noble/main/binary-amd64/Packages" },
          { key: "repositories/debian-internal/dists/noble/main/binary-amd64/Packages.gz" },
          { key: "repositories/debian-internal/dists/noble/Release" },
          { key: "repositories/debian-internal/dists/noble/InRelease" },
          { key: "repositories/debian-internal/dists/noble/Release.gpg" },
        ],
      },
    });
    expect(readBucketBytes(bucket, "repositories/debian-internal/pool/main/myapp/myapp_1.2.3_amd64.deb"))
      .toHaveLength(debBytes.byteLength);
    expect(readBucketText(bucket, "repositories/debian-internal/dists/noble/main/binary-amd64/Packages"))
      .toContain("Filename: pool/main/myapp/myapp_1.2.3_amd64.deb");
    expect(readBucketText(bucket, "repositories/debian-internal/dists/noble/Release"))
      .toContain("main/binary-amd64/Packages");
    expect(readBucketText(bucket, "repositories/debian-internal/dists/noble/InRelease"))
      .toContain("-----BEGIN PGP SIGNED MESSAGE-----");
    expect(readBucketText(bucket, "repositories/debian-internal/dists/noble/Release.gpg"))
      .toContain("-----BEGIN PGP SIGNATURE-----");

    const read = await object.fetch(
      new Request("https://axis.example/repositories/debian-internal/dists/noble/InRelease", {
        headers: { authorization: `Bearer ${tokenBody.secret}` },
      }),
    );

    expect(read.status).toBe(200);
    expect(read.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    await expect(read.text()).resolves.toContain("-----BEGIN PGP SIGNED MESSAGE-----");

    const basicRead = await object.fetch(
      new Request("https://axis.example/repositories/debian-internal/dists/noble/InRelease", {
        headers: { authorization: basicAuth(tokenBody.secret) },
      }),
    );

    expect(basicRead.status).toBe(200);
    await expect(basicRead.text()).resolves.toContain("-----BEGIN PGP SIGNED MESSAGE-----");

    const rangedRead = await object.fetch(
      new Request("https://axis.example/repositories/debian-internal/dists/noble/InRelease", {
        headers: {
          authorization: `Bearer ${tokenBody.secret}`,
          range: "bytes=0-9",
        },
      }),
    );

    expect(rangedRead.status).toBe(206);
    expect(rangedRead.headers.get("content-range")).toMatch(/^bytes 0-9\/\d+$/);
    expect(rangedRead.headers.get("content-length")).toBe("10");
    expect(rangedRead.headers.get("etag")).toBeTruthy();
    await expect(rangedRead.text()).resolves.toBe("-----BEGIN");
  });

  it("fails closed when finalizing an unregistered ecosystem with memory backend", async () => {
    const object = createObject({
      UPLOAD_BACKEND: "memory",
      AXIS_OBJECTS: undefined,
      R2_ACCOUNT_ID: undefined,
      R2_BUCKET_NAME: undefined,
      R2_ACCESS_KEY_ID: undefined,
      R2_SECRET_ACCESS_KEY: undefined,
    });
    const adminAuthorization = await adminAuthorizationHeader(object);

    const createRepository = await object.fetch(
      new Request("https://axis.example/admin/repositories", {
        method: "POST",
        headers: {
          authorization: adminAuthorization,
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

  it("still allows removed bootstrap credentials for memory backend", () => {
    expect(() => createObject({
      UPLOAD_BACKEND: "memory",
      AXIS_ADMIN_USERNAME: undefined,
      AXIS_ADMIN_PASSWORD: undefined,
      AXIS_ADMIN_PASSWORD_HASH: undefined,
    })).not.toThrow();
    expect(() => createObject({ UPLOAD_BACKEND: "memory", AXIS_SESSION_SECRET: undefined })).toThrow(
      "AXIS_SESSION_SECRET is required for AxisAdminDO",
    );
  });

  it("still requires token hash pepper for memory backend", () => {
    expect(() => createObject({ UPLOAD_BACKEND: "memory", TOKEN_HASH_PEPPER: undefined })).toThrow(
      "TOKEN_HASH_PEPPER is required for AxisAdminDO",
    );
  });

  it("rejects invalid upload backend values", () => {
    expect(() => createObject({ UPLOAD_BACKEND: "disk" })).toThrow(
      "UPLOAD_BACKEND must be one of: r2, local-r2, memory",
    );
  });

  it("persists repository state across requests", async () => {
    const object = createObject();
    const adminAuthorization = await adminAuthorizationHeader(object);

    const create = await object.fetch(
      new Request("https://axis.example/admin/repositories", {
        method: "POST",
        headers: {
          authorization: adminAuthorization,
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "debian-internal", ecosystem: "apt", config: validAptConfig() }),
      }),
    );
    expect(create.status).toBe(201);

    const list = await object.fetch(
      new Request("https://axis.example/admin/repositories", {
        headers: { authorization: adminAuthorization },
      }),
    );

    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({
      repositories: [{ name: "debian-internal", ecosystem: "apt" }],
    });
  });

  it("creates publish sessions with R2 presigned upload targets", async () => {
    const object = createObject();
    const adminAuthorization = await adminAuthorizationHeader(object);

    const createRepository = await object.fetch(
      new Request("https://axis.example/admin/repositories", {
        method: "POST",
        headers: {
          authorization: adminAuthorization,
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "debian-internal", ecosystem: "apt", config: validAptConfig() }),
      }),
    );
    expect(createRepository.status).toBe(201);

    const createToken = await object.fetch(
      new Request("https://axis.example/admin/publish-tokens", {
        method: "POST",
        headers: {
          authorization: adminAuthorization,
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
    expect(createToken.status).toBe(201);
    const tokenBody = (await createToken.json()) as { secret: string };

    const createSession = await object.fetch(
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

    expect(createSession.status).toBe(201);
    const sessionBody = (await createSession.json()) as {
      uploads: Array<{ url: string; headers: Record<string, string> }>;
    };
    const upload = sessionBody.uploads[0];
    if (!upload) {
      throw new Error("Expected publish session to include an upload target");
    }
    expect(new URL(upload.url).origin).toBe("https://account123.r2.cloudflarestorage.com");
    expect(upload.headers).toMatchObject({
      "x-amz-meta-axis-sha256": "a".repeat(64),
      "x-amz-meta-axis-upload-id": expect.any(String),
    });
  });

  it("stores local R2 uploads through same-origin upload targets", async () => {
    const bucket = new FakeR2Bucket();
    const object = createObject({
      AXIS_OBJECTS: bucket as unknown as R2Bucket,
      UPLOAD_BACKEND: "local-r2",
      R2_ACCOUNT_ID: undefined,
      R2_BUCKET_NAME: undefined,
      R2_ACCESS_KEY_ID: undefined,
      R2_SECRET_ACCESS_KEY: undefined,
    });
    const adminAuthorization = await adminAuthorizationHeader(object);

    const createRepository = await object.fetch(
      new Request("https://axis.example/admin/repositories", {
        method: "POST",
        headers: {
          authorization: adminAuthorization,
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "debian-internal", ecosystem: "apt", config: validAptConfig() }),
      }),
    );
    expect(createRepository.status).toBe(201);

    const createToken = await object.fetch(
      new Request("https://axis.example/admin/publish-tokens", {
        method: "POST",
        headers: {
          authorization: adminAuthorization,
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
    expect(createToken.status).toBe(201);
    const tokenBody = (await createToken.json()) as { secret: string };

    const body = new Uint8Array([1, 2, 3]);
    const createSession = await object.fetch(
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
              size: body.byteLength,
              sha256: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
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
    expect(createSession.status).toBe(201);
    const session = (await createSession.json()) as {
      id: string;
      uploads: Array<{ uploadId: string; objectKey: string; url: string }>;
    };
    const upload = session.uploads[0]!;

    expect(upload.url).toBe(`/api/uploads/${session.id}/${upload.uploadId}`);

    const put = await object.fetch(
      new Request(`https://axis.example${upload.url}`, {
        method: "PUT",
        headers: { "content-type": "application/vnd.debian.binary-package" },
        body,
      }),
    );
    expect(put.status).toBe(204);
    expect(readBucketBytes(bucket, upload.objectKey)).toEqual(body);

    const verify = await object.fetch(
      new Request(`https://axis.example/api/publish-sessions/${session.id}/uploads/${upload.uploadId}/verify`, {
        method: "POST",
        headers: { authorization: `Bearer ${tokenBody.secret}` },
      }),
    );

    expect(verify.status).toBe(200);
  });
});
