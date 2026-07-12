import { describe, expect, it } from "vitest";
import { createApp } from "./app";

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
});
