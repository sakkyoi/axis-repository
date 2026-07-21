import { describe, expect, it } from "vitest";
import { getRuntimeConfig, normalizeApiBaseUrl, type AxisAdminWindow } from "./runtime-config";

describe("runtime config", () => {
  it("defaults API base URL to same-origin", () => {
    const windowLike: AxisAdminWindow = {};

    expect(getRuntimeConfig(windowLike)).toEqual({ apiBaseUrl: "" });
  });

  it("normalizes configured API base URL", () => {
    const windowLike: AxisAdminWindow = {
      __AXIS_ADMIN_CONFIG__: { apiBaseUrl: "https://axis.example/api///" },
    };

    expect(getRuntimeConfig(windowLike)).toEqual({ apiBaseUrl: "https://axis.example/api" });
  });

  it("treats blank and slash API base URLs as same-origin", () => {
    expect(normalizeApiBaseUrl("")).toBe("");
    expect(normalizeApiBaseUrl("   ")).toBe("");
    expect(normalizeApiBaseUrl("/")).toBe("");
  });
});
