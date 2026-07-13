import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";

afterEach(() => {
  vi.doUnmock("./app");
  vi.resetModules();
});

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
});
