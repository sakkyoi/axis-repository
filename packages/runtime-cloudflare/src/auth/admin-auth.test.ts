import { describe, expect, it } from "vitest";
import { UnauthorizedError } from "@axis-repository/core";
import {
  HmacAdminAccessTokenCodec,
  adminRefreshCookie,
  clearAdminRefreshCookie,
  refreshTokenFromCookie,
} from "./admin-auth";

describe("HmacAdminAccessTokenCodec", () => {
  it("creates and verifies admin access tokens", async () => {
    const codec = new HmacAdminAccessTokenCodec("session-secret", () => new Date("2026-07-26T00:00:00.000Z"));
    const token = await codec.create({
      type: "admin",
      subject: "admin_user_1",
      username: "admin",
      role: "owner",
      scopes: ["admin:*"],
      sessionId: "admin_session_1",
    }, new Date("2026-07-26T00:15:00.000Z"));

    await expect(codec.verify(token)).resolves.toEqual({
      type: "admin",
      subject: "admin_user_1",
      username: "admin",
      role: "owner",
      scopes: ["admin:*"],
      sessionId: "admin_session_1",
    });
  });

  it("rejects expired or tampered admin access tokens", async () => {
    const codec = new HmacAdminAccessTokenCodec("session-secret", () => new Date("2026-07-26T00:20:00.000Z"));
    const token = await new HmacAdminAccessTokenCodec("session-secret").create({
      type: "admin",
      subject: "admin_user_1",
      username: "admin",
      role: "owner",
      scopes: ["admin:*"],
      sessionId: "admin_session_1",
    }, new Date("2026-07-26T00:15:00.000Z"));

    await expect(codec.verify(token)).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(new HmacAdminAccessTokenCodec("other-secret").verify(token)).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe("admin refresh cookies", () => {
  it("sets, reads, and clears refresh cookies", () => {
    const cookie = adminRefreshCookie("refresh-secret", "2026-08-25T00:00:00.000Z");

    expect(cookie).toContain("axis_admin_refresh=refresh-secret");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/admin/auth");
    expect(refreshTokenFromCookie(new Request("https://axis.example", { headers: { cookie } }))).toBe("refresh-secret");
    expect(clearAdminRefreshCookie()).toContain("Max-Age=0");
    expect(clearAdminRefreshCookie()).toContain("Secure");
    expect(clearAdminRefreshCookie()).toContain("HttpOnly");
  });
});
