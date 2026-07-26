import { describe, expect, it } from "vitest";
import {
  AdminAuthService,
  MemoryStateStore,
  UnauthorizedError,
  type AdminAccessTokenCodec,
  type AdminPasswordVerifier,
  type Clock,
  type RandomId,
  type SecretHasher,
} from "../index";

const clock: Clock = {
  now: () => new Date("2026-07-26T00:00:00.000Z"),
};

const randomId: RandomId = {
  create: (prefix) => `${prefix}_fixed`,
};

const hasher: SecretHasher = {
  hash: async (secret) => `hash:${secret}`,
  verify: async (secret, hash) => hash === `hash:${secret}`,
};

const passwordVerifier: AdminPasswordVerifier = {
  verify: async (username, password) => username === "admin" && password === "correct-password",
};

const accessTokens: AdminAccessTokenCodec = {
  create: async (principal, expiresAt) => `access:${principal.sessionId}:${principal.subject}:${expiresAt.toISOString()}`,
  verify: async (token) => {
    const [, sessionId, subject] = token.split(":");
    if (!sessionId || !subject) throw new UnauthorizedError();
    return { type: "admin", subject, scopes: ["admin:*"], sessionId };
  },
};

describe("AdminAuthService", () => {
  it("logs in with bootstrap credentials and creates access and refresh tokens", async () => {
    const service = createService();

    const result = await service.login({
      username: "admin",
      password: "correct-password",
    });

    expect(result).toEqual({
      accessToken: "access:admin_session_fixed:admin:2026-07-26T00:15:00.000Z",
      accessTokenExpiresAt: "2026-07-26T00:15:00.000Z",
      refreshToken: "axis_refresh_refresh_fixed",
      refreshTokenExpiresAt: "2026-08-25T00:00:00.000Z",
      principal: {
        type: "admin",
        subject: "admin",
        scopes: ["admin:*"],
        sessionId: "admin_session_fixed",
      },
    });
  });

  it("rejects invalid bootstrap credentials", async () => {
    await expect(createService().login({
      username: "admin",
      password: "wrong-password",
    })).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("refreshes sessions by rotating the refresh token", async () => {
    const state = new MemoryStateStore();
    let sequence = 0;
    const service = createService({
      state,
      randomId: { create: (prefix) => `${prefix}_${++sequence}` },
    });
    const login = await service.login({ username: "admin", password: "correct-password" });

    const refreshed = await service.refresh(login.refreshToken);

    expect(refreshed.refreshToken).toBe("axis_refresh_refresh_3");
    await expect(service.refresh(login.refreshToken)).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(service.verifyAccessToken(refreshed.accessToken)).resolves.toMatchObject({
      subject: "admin",
      scopes: ["admin:*"],
    });
  });

  it("logs out refresh sessions", async () => {
    const service = createService();
    const login = await service.login({ username: "admin", password: "correct-password" });

    await service.logout(login.refreshToken);

    await expect(service.refresh(login.refreshToken)).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

function createService(overrides: Partial<ConstructorParameters<typeof AdminAuthService>[0]> = {}) {
  return new AdminAuthService({
    state: new MemoryStateStore(),
    clock,
    randomId,
    hasher,
    passwordVerifier,
    accessTokens,
    ...overrides,
  });
}
