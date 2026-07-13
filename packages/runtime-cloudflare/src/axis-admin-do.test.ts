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

type TestAxisEnv = {
  AXIS_ADMIN?: DurableObjectNamespace | undefined;
  ADMIN_TOKEN?: string | undefined;
  TOKEN_HASH_PEPPER?: string | undefined;
};

function createObject(env: TestAxisEnv = {}) {
  return new AxisAdminDO({ storage: new FakeDurableStorage() } as unknown as DurableObjectState, {
    ADMIN_TOKEN: "admin",
    TOKEN_HASH_PEPPER: "pepper",
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
});
