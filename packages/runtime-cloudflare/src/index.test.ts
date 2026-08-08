import { describe, expect, it, vi } from "vitest";
import worker from "./index";
import type { AxisEnv } from "./worker/cloudflare-runtime";

class FakeR2Bucket {
  async head(): Promise<null> {
    return null;
  }
}

class FakeQueue {
  async send(): Promise<void> {}
}

function axisEnv(overrides: Partial<AxisEnv> = {}): AxisEnv {
  return {
    AXIS_SHARED_STATE: {} as D1Database,
    AXIS_BACKGROUND_JOBS: new FakeQueue() as unknown as Queue,
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

describe("worker entrypoint", () => {
  it("serves requests from the Cloudflare runtime bindings without an admin Durable Object", async () => {
    const env = axisEnv({
      ADMIN_UI_API_BASE_URL: "https://admin-api.example/base",
    });

    const root = await worker.fetch(new Request("https://axis.example/"), env as unknown as AxisEnv);
    const response = await worker.fetch(new Request("https://axis.example/ui/"), env as unknown as AxisEnv);

    expect(root.status).toBe(302);
    expect(root.headers.get("location")).toBe("/ui/");
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain('"apiBaseUrl":"https://admin-api.example/base"');
  });

  it("refuses every request when production runtime state bindings are missing", async () => {
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
        const response = await worker.fetch(request, {
          ADMIN_UI_API_BASE_URL: "",
          AXIS_BACKGROUND_JOBS: new FakeQueue() as unknown as Queue,
        } as unknown as AxisEnv);

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

  it("requires shared state and queue bindings for scheduled background jobs", async () => {
    const env = axisEnv();
    delete env.AXIS_SHARED_STATE;

    await expect(worker.scheduled(
      { cron: "*/5 * * * *", scheduledTime: Date.now(), type: "scheduled", noRetry: () => {} } as ScheduledController,
      env as unknown as AxisEnv,
      {} as ExecutionContext,
    )).rejects.toThrow("AXIS_SHARED_STATE and AXIS_BACKGROUND_JOBS are required for scheduled background jobs");
  });
});
