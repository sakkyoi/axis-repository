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

describe("worker entrypoint", () => {
  it("proxies API requests to the configured AxisAdminDO", async () => {
    const object = new AxisAdminDO({ storage: new FakeDurableStorage() } as unknown as DurableObjectState, {
      ADMIN_TOKEN: "admin",
      TOKEN_HASH_PEPPER: "pepper",
    });
    const namespace = new FakeNamespace(object);
    const env = {
      AXIS_ADMIN: namespace,
      ADMIN_TOKEN: "admin",
      TOKEN_HASH_PEPPER: "pepper",
    } as unknown as AxisEnv;

    const response = await worker.fetch(
      new Request("https://axis.example/admin/repositories", {
        method: "POST",
        headers: {
          authorization: "Bearer admin",
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "debian-internal", ecosystem: "apt" }),
      }),
      env,
    );

    expect(response.status).toBe(201);
    expect(namespace.requestedNames).toEqual(["global"]);
  });
});
