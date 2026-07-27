import { describe, expect, it } from "vitest";
import { UnauthorizedError } from "@axis-repository/core";
import {
  HmacAdminAccessTokenCodec,
  adminRefreshCookie,
  clearAdminRefreshCookie,
  refreshTokenFromCookie,
  requestIsSecure,
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
    const cookie = adminRefreshCookie({
      refreshToken: "refresh-secret",
      expiresAt: "2026-08-25T00:00:00.000Z",
      secure: true,
    });

    expect(cookie).toContain("axis_admin_refresh=refresh-secret");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/admin/auth");
    expect(refreshTokenFromCookie(new Request("https://axis.example", { headers: { cookie } }))).toBe("refresh-secret");
    expect(clearAdminRefreshCookie(true)).toContain("Max-Age=0");
    expect(clearAdminRefreshCookie(true)).toContain("Secure");
    expect(clearAdminRefreshCookie(true)).toContain("HttpOnly");
  });

  it("leaves Secure off over plain HTTP, which would otherwise drop the cookie", () => {
    // A browser discards a Secure cookie sent from an http:// origin without
    // reporting anything, so the session would end at the next page load.
    const cookie = adminRefreshCookie({
      refreshToken: "refresh-secret",
      expiresAt: "2026-08-25T00:00:00.000Z",
      secure: false,
    });

    expect(cookie).not.toContain("Secure");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/admin/auth");
    // Clearing has to match the attributes it set, or the original survives.
    expect(clearAdminRefreshCookie(false)).not.toContain("Secure");
    expect(clearAdminRefreshCookie(false)).toContain("Max-Age=0");
  });

  it("decides from the request scheme, not from a header a client controls", () => {
    expect(requestIsSecure(new Request("https://axis.example/admin/auth/refresh"))).toBe(true);
    expect(requestIsSecure(new Request("http://10.0.0.5:8787/admin/auth/refresh", {
      headers: { "x-forwarded-proto": "https" },
    }))).toBe(false);
  });
});
