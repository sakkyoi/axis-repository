import { describe, expect, it } from "vitest";
import { AxisAdminDO, type AxisEnv } from "./axis-admin-do";
import type { DurableStorage } from "./durable-state";

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

  async head(key: string): Promise<{ size: number; customMetadata?: Record<string, string> } | null> {
    const object = this.objects.get(key);
    if (!object) {
      return null;
    }
    return {
      size: object.value instanceof Uint8Array ? object.value.byteLength : new TextEncoder().encode(object.value).byteLength,
      ...(object.customMetadata ? { customMetadata: object.customMetadata } : {}),
    };
  }

  async get(key: string): Promise<{
    httpMetadata?: { contentType?: string };
    arrayBuffer(): Promise<ArrayBuffer>;
  } | null> {
    const object = this.objects.get(key);
    if (!object) {
      return null;
    }
    const bytes = object.value instanceof Uint8Array ? object.value : new TextEncoder().encode(object.value);
    return {
      ...(object.contentType ? { httpMetadata: { contentType: object.contentType } } : {}),
      arrayBuffer: async () => toArrayBuffer(bytes),
    };
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

type TestAxisEnv = {
  AXIS_ADMIN?: DurableObjectNamespace | undefined;
  AXIS_OBJECTS?: R2Bucket | undefined;
  ADMIN_TOKEN?: string | undefined;
  TOKEN_HASH_PEPPER?: string | undefined;
  SIGNING_KEY_ENCRYPTION_SECRET?: string | undefined;
  R2_ACCOUNT_ID?: string | undefined;
  R2_BUCKET_NAME?: string | undefined;
  R2_ACCESS_KEY_ID?: string | undefined;
  R2_SECRET_ACCESS_KEY?: string | undefined;
  UPLOAD_URL_TTL_SECONDS?: string | undefined;
  UPLOAD_BACKEND?: string | undefined;
};

function createObject(env: TestAxisEnv = {}) {
  return new AxisAdminDO({ storage: new FakeDurableStorage() } as unknown as DurableObjectState, {
    AXIS_OBJECTS: new FakeR2Bucket() as unknown as R2Bucket,
    ADMIN_TOKEN: "admin",
    TOKEN_HASH_PEPPER: "pepper",
    SIGNING_KEY_ENCRYPTION_SECRET: "local-signing-secret",
    R2_ACCOUNT_ID: "account123",
    R2_BUCKET_NAME: "axis-repository",
    R2_ACCESS_KEY_ID: "access",
    R2_SECRET_ACCESS_KEY: "secret",
    ...env,
  } as AxisEnv);
}

describe("AxisAdminDO", () => {
  it("requires an admin token", () => {
    expect(() => createObject({ ADMIN_TOKEN: undefined })).toThrow(
      "ADMIN_TOKEN is required for AxisAdminDO",
    );
    expect(() => createObject({ ADMIN_TOKEN: "" })).toThrow(
      "ADMIN_TOKEN is required for AxisAdminDO",
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
      ADMIN_TOKEN: "test-admin-token",
      R2_ACCOUNT_ID: undefined,
      R2_BUCKET_NAME: undefined,
      R2_ACCESS_KEY_ID: undefined,
      R2_SECRET_ACCESS_KEY: undefined,
    });

    const response = await object.fetch(
      new Request("https://axis.example/admin/repositories", {
        method: "POST",
        headers: {
          authorization: "Bearer test-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "debian-internal", ecosystem: "apt" }),
      }),
    );

    expect(response.status).toBe(201);
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
    const object = createObject({
      AXIS_OBJECTS: bucket as unknown as R2Bucket,
      ADMIN_TOKEN: "test-admin-token",
    });

    const createSigningKey = await object.fetch(
      new Request("https://axis.example/admin/signing-keys", {
        method: "POST",
        headers: {
          authorization: "Bearer test-admin-token",
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
          authorization: "Bearer test-admin-token",
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
          authorization: "Bearer test-admin-token",
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
    const session = (await createSession.json()) as {
      id: string;
      uploads: Array<{ uploadId: string; objectKey: string }>;
    };
    const upload = session.uploads[0];
    if (!upload) {
      throw new Error("Expected publish session to include an upload target");
    }
    bucket.seedUpload(
      upload.objectKey,
      new Uint8Array(1234),
      {
        contentType: "application/vnd.debian.binary-package",
        size: 1234,
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
      .toHaveLength(1234);
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
  });

  it("fails closed when finalizing an unregistered ecosystem with memory backend", async () => {
    const object = createObject({
      UPLOAD_BACKEND: "memory",
      AXIS_OBJECTS: undefined,
      ADMIN_TOKEN: "test-admin-token",
      R2_ACCOUNT_ID: undefined,
      R2_BUCKET_NAME: undefined,
      R2_ACCESS_KEY_ID: undefined,
      R2_SECRET_ACCESS_KEY: undefined,
    });

    const createRepository = await object.fetch(
      new Request("https://axis.example/admin/repositories", {
        method: "POST",
        headers: {
          authorization: "Bearer test-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "python-internal", ecosystem: "pypi" }),
      }),
    );
    expect(createRepository.status).toBe(201);

    const createToken = await object.fetch(
      new Request("https://axis.example/admin/publish-tokens", {
        method: "POST",
        headers: {
          authorization: "Bearer test-admin-token",
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
    expect(createSession.status).toBe(201);
    const session = (await createSession.json()) as {
      id: string;
      uploads: Array<{ uploadId: string }>;
    };
    const upload = session.uploads[0];
    if (!upload) {
      throw new Error("Expected publish session to include an upload target");
    }

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

    expect(finalize.status).toBe(400);
    await expect(finalize.json()).resolves.toEqual({
      error: {
        code: "validation_error",
        message: "Artifact publisher is not configured for ecosystem: pypi",
      },
    });
  });

  it("still requires admin token for memory backend", () => {
    expect(() => createObject({ UPLOAD_BACKEND: "memory", ADMIN_TOKEN: undefined })).toThrow(
      "ADMIN_TOKEN is required for AxisAdminDO",
    );
  });

  it("still requires token hash pepper for memory backend", () => {
    expect(() => createObject({ UPLOAD_BACKEND: "memory", TOKEN_HASH_PEPPER: undefined })).toThrow(
      "TOKEN_HASH_PEPPER is required for AxisAdminDO",
    );
  });

  it("rejects invalid upload backend values", () => {
    expect(() => createObject({ UPLOAD_BACKEND: "disk" })).toThrow(
      "UPLOAD_BACKEND must be one of: r2, memory",
    );
  });

  it("persists repository state across requests", async () => {
    const object = createObject();

    const create = await object.fetch(
      new Request("https://axis.example/admin/repositories", {
        method: "POST",
        headers: {
          authorization: "Bearer admin",
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "debian-internal", ecosystem: "apt" }),
      }),
    );
    expect(create.status).toBe(201);

    const list = await object.fetch(
      new Request("https://axis.example/admin/repositories", {
        headers: { authorization: "Bearer admin" },
      }),
    );

    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({
      repositories: [{ name: "debian-internal", ecosystem: "apt" }],
    });
  });

  it("creates publish sessions with R2 presigned upload targets", async () => {
    const object = createObject();

    const createRepository = await object.fetch(
      new Request("https://axis.example/admin/repositories", {
        method: "POST",
        headers: {
          authorization: "Bearer admin",
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "debian-internal", ecosystem: "apt" }),
      }),
    );
    expect(createRepository.status).toBe(201);

    const createToken = await object.fetch(
      new Request("https://axis.example/admin/publish-tokens", {
        method: "POST",
        headers: {
          authorization: "Bearer admin",
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
              metadata: {},
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
});
