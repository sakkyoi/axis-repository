import { describe, expect, it } from "vitest";
import { normalizeAccessToken } from "./auth";

describe("admin auth state", () => {
  it("normalizes access tokens for in-memory auth state", () => {
    expect(normalizeAccessToken("  access-token  ")).toBe("access-token");
  });
});
