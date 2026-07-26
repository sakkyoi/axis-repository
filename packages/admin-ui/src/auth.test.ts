import { describe, expect, it } from "vitest";
import { authBootstrapStateFromRefresh, normalizeAccessToken } from "./auth";

describe("admin auth state", () => {
  it("normalizes access tokens for in-memory auth state", () => {
    expect(normalizeAccessToken("  access-token  ")).toBe("access-token");
  });

  it("treats failed bootstrap refreshes as anonymous sessions", () => {
    expect(authBootstrapStateFromRefresh(null)).toEqual({
      accessToken: "",
      isAuthenticated: false,
      shouldClearQueries: false,
    });
  });

  it("treats successful bootstrap refreshes as authenticated sessions", () => {
    expect(authBootstrapStateFromRefresh({
      accessToken: "  refreshed-access-token  ",
      accessTokenExpiresAt: "2026-07-26T00:15:00.000Z",
      principal: {
        type: "admin",
        subject: "admin_user_1",
        username: "admin",
        role: "owner",
        scopes: ["admin:*"],
        sessionId: "admin_session_1",
      },
    })).toEqual({
      accessToken: "refreshed-access-token",
      isAuthenticated: true,
      shouldClearQueries: true,
    });
  });
});
