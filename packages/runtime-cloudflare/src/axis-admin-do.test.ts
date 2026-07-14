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
  async head(): Promise<null> {
    return null;
  }
}

type TestAxisEnv = {
  AXIS_ADMIN?: DurableObjectNamespace | undefined;
  AXIS_OBJECTS?: R2Bucket | undefined;
  ADMIN_TOKEN?: string | undefined;
  TOKEN_HASH_PEPPER?: string | undefined;
  R2_ACCOUNT_ID?: string | undefined;
  R2_BUCKET_NAME?: string | undefined;
  R2_ACCESS_KEY_ID?: string | undefined;
  R2_SECRET_ACCESS_KEY?: string | undefined;
  UPLOAD_URL_TTL_SECONDS?: string | undefined;
};

function createObject(env: TestAxisEnv = {}) {
  return new AxisAdminDO({ storage: new FakeDurableStorage() } as unknown as DurableObjectState, {
    AXIS_OBJECTS: new FakeR2Bucket() as unknown as R2Bucket,
    ADMIN_TOKEN: "admin",
    TOKEN_HASH_PEPPER: "pepper",
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
