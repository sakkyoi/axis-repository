import { describe, expect, it } from "vitest";
import worker, { AxisAdminDO } from "./index";
import type { AxisEnv } from "./axis-admin-do";
import type { DurableStorage } from "./durable-state";

class FakeNamespace {
  readonly object: AxisAdminDO;
  readonly requestedNames: string[] = [];

  constructor(object: AxisAdminDO) {
    this.object = object;
  }

  idFromName(name: string) {
    this.requestedNames.push(name);
    return { name };
  }

  get() {
    return {
      fetch: (request: Request) => this.object.fetch(request),
    };
  }
}

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
      if (!options?.prefix || key.startsWith(options.prefix)) result.set(key, value as T);
    }
    return result;
  }
}

class FakeR2Bucket {
  async head(): Promise<null> {
    return null;
  }
}

describe("worker entrypoint", () => {
  it("proxies API requests to the configured AxisAdminDO", async () => {
    const object = new AxisAdminDO({ storage: new FakeDurableStorage() } as unknown as DurableObjectState, {
      AXIS_OBJECTS: new FakeR2Bucket() as unknown as R2Bucket,
      ADMIN_TOKEN: "admin",
      TOKEN_HASH_PEPPER: "pepper",
      SIGNING_KEY_ENCRYPTION_SECRET: "signing-secret",
      R2_ACCOUNT_ID: "account123",
      R2_BUCKET_NAME: "axis-repository",
      R2_ACCESS_KEY_ID: "access",
      R2_SECRET_ACCESS_KEY: "secret",
    });
    const namespace = new FakeNamespace(object);
    const env = {
      AXIS_ADMIN: namespace,
      AXIS_OBJECTS: new FakeR2Bucket(),
      ADMIN_TOKEN: "admin",
      TOKEN_HASH_PEPPER: "pepper",
      SIGNING_KEY_ENCRYPTION_SECRET: "signing-secret",
      R2_ACCOUNT_ID: "account123",
      R2_BUCKET_NAME: "axis-repository",
      R2_ACCESS_KEY_ID: "access",
      R2_SECRET_ACCESS_KEY: "secret",
    } as unknown as AxisEnv;

    const response = await worker.fetch(
      new Request("https://axis.example/admin/repositories", {
        method: "POST",
        headers: {
          authorization: "Bearer admin",
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
              signingKeyId: "signing_key_prod",
            },
          },
        }),
      }),
      env,
    );

    expect(response.status).toBe(201);
    expect(namespace.requestedNames).toEqual(["global"]);
  });

  it("passes admin UI runtime config from Worker env into the Durable Object app", async () => {
    const object = new AxisAdminDO({ storage: new FakeDurableStorage() } as unknown as DurableObjectState, {
      AXIS_OBJECTS: new FakeR2Bucket() as unknown as R2Bucket,
      ADMIN_TOKEN: "admin",
      TOKEN_HASH_PEPPER: "pepper",
      SIGNING_KEY_ENCRYPTION_SECRET: "signing-secret",
      R2_ACCOUNT_ID: "account123",
      R2_BUCKET_NAME: "axis-repository",
      R2_ACCESS_KEY_ID: "access",
      R2_SECRET_ACCESS_KEY: "secret",
      ADMIN_UI_API_BASE_URL: "https://admin-api.example/base",
    });
    const namespace = new FakeNamespace(object);
    const env = {
      AXIS_ADMIN: namespace,
      AXIS_OBJECTS: new FakeR2Bucket(),
      ADMIN_TOKEN: "admin",
      TOKEN_HASH_PEPPER: "pepper",
      SIGNING_KEY_ENCRYPTION_SECRET: "signing-secret",
      R2_ACCOUNT_ID: "account123",
      R2_BUCKET_NAME: "axis-repository",
      R2_ACCESS_KEY_ID: "access",
      R2_SECRET_ACCESS_KEY: "secret",
      ADMIN_UI_API_BASE_URL: "https://admin-api.example/base",
    } as unknown as AxisEnv;

    const root = await worker.fetch(new Request("https://axis.example/"), env);
    const response = await worker.fetch(new Request("https://axis.example/ui/"), env);

    expect(root.status).toBe(302);
    expect(root.headers.get("location")).toBe("/ui/");
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain('"apiBaseUrl":"https://admin-api.example/base"');
    expect(namespace.requestedNames).toEqual(["global", "global"]);
  });

  it("passes admin UI runtime config from Worker env into the fallback app", async () => {
    const root = await worker.fetch(
      new Request("https://axis.example/"),
      { ADMIN_UI_API_BASE_URL: "https://fallback-api.example/base" } as unknown as AxisEnv,
    );
    const response = await worker.fetch(
      new Request("https://axis.example/ui/"),
      { ADMIN_UI_API_BASE_URL: "https://fallback-api.example/base" } as unknown as AxisEnv,
    );

    expect(root.status).toBe(302);
    expect(root.headers.get("location")).toBe("/ui/");
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain('"apiBaseUrl":"https://fallback-api.example/base"');
  });
});
