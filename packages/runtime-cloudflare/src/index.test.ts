import { describe, expect, it, vi } from "vitest";
import worker, { AxisAdminDO } from "./index";
import type { AxisEnv } from "./worker/axis-admin-do";
import { fakeDurableObjectState } from "./worker/durable-object.test-support";

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

class FakeR2Bucket {
  async head(): Promise<null> {
    return null;
  }
}

function axisEnv(overrides: Partial<AxisEnv> = {}): AxisEnv {
  return {
    AXIS_OBJECTS: new FakeR2Bucket() as unknown as R2Bucket,
    AXIS_ADMIN_USERNAME: "admin",
    AXIS_ADMIN_PASSWORD: "admin-password",
    AXIS_SESSION_SECRET: "test-session-secret",
    TOKEN_HASH_PEPPER: "pepper",
    SIGNING_KEY_ENCRYPTION_SECRET: "signing-secret",
    R2_ACCOUNT_ID: "account123",
    R2_BUCKET_NAME: "axis-repository",
    R2_ACCESS_KEY_ID: "access",
    R2_SECRET_ACCESS_KEY: "secret",
    ...overrides,
  };
}

async function adminAccessToken(fetch: (request: Request) => Promise<Response>): Promise<string> {
  const response = await fetch(new Request("https://axis.example/admin/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin-password" }),
  }));
  expect(response.status).toBe(200);
  const body = await response.json() as { accessToken: string };
  return body.accessToken;
}

describe("worker entrypoint", () => {
  it("proxies API requests to the configured AxisAdminDO", async () => {
    const object = new AxisAdminDO(fakeDurableObjectState() as unknown as DurableObjectState, axisEnv());
    const namespace = new FakeNamespace(object);
    const env = {
      ...axisEnv(),
      AXIS_ADMIN: namespace,
    };
    const accessToken = await adminAccessToken((request) => worker.fetch(request, env as unknown as AxisEnv));

    const response = await worker.fetch(
      new Request("https://axis.example/admin/repositories", {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
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
      env as unknown as AxisEnv,
    );

    expect(response.status).toBe(201);
    expect(namespace.requestedNames).toEqual(["global", "global"]);
  });

  it("passes admin UI runtime config from Worker env into the Durable Object app", async () => {
    const object = new AxisAdminDO(fakeDurableObjectState() as unknown as DurableObjectState, axisEnv({
      ADMIN_UI_API_BASE_URL: "https://admin-api.example/base",
    }));
    const namespace = new FakeNamespace(object);
    const env = {
      ...axisEnv({
        ADMIN_UI_API_BASE_URL: "https://admin-api.example/base",
      }),
      AXIS_ADMIN: namespace,
    };

    const root = await worker.fetch(new Request("https://axis.example/"), env as unknown as AxisEnv);
    const response = await worker.fetch(new Request("https://axis.example/ui/"), env as unknown as AxisEnv);

    expect(root.status).toBe(302);
    expect(root.headers.get("location")).toBe("/ui/");
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain('"apiBaseUrl":"https://admin-api.example/base"');
    expect(namespace.requestedNames).toEqual(["global", "global"]);
  });

  it("refuses every request when the AxisAdminDO binding is missing", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const request of [
        new Request("https://axis.example/"),
        new Request("https://axis.example/ui/"),
        new Request("https://axis.example/health"),
        new Request("https://axis.example/admin/repositories", {
          headers: { authorization: "Bearer dev-admin-token" },
        }),
        new Request("https://axis.example/admin/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ username: "admin", password: "admin-local-password" }),
        }),
      ]) {
        const response = await worker.fetch(request, { ADMIN_UI_API_BASE_URL: "" } as unknown as AxisEnv);

        expect(response.status).toBe(503);
        expect(response.headers.get("x-content-type-options")).toBe("nosniff");
        await expect(response.json()).resolves.toEqual({
          error: { code: "service_unavailable", message: "Service Unavailable" },
        });
      }
    } finally {
      consoleError.mockRestore();
    }
  });

  it("refuses requests when no env is supplied at all", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await worker.fetch(new Request("https://axis.example/health"));

      expect(response.status).toBe(503);
    } finally {
      consoleError.mockRestore();
    }
  });
});
