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
});
