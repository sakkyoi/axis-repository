import { describe, expect, it } from "vitest";
import {
  AdminAuthService,
  MemoryStateStore,
  UnauthorizedError,
  type AdminAccessTokenCodec,
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

const accessTokens: AdminAccessTokenCodec = {
  create: async (principal, expiresAt) =>
    `access:${principal.sessionId}:${principal.subject}:${principal.username}:${principal.role}:${expiresAt.toISOString()}`,
  verify: async (token) => {
    const [, sessionId, subject, username, role] = token.split(":");
    if (!sessionId || !subject || !username || role !== "owner") throw new UnauthorizedError();
    return { type: "admin", subject, username, role, scopes: ["admin:*"], sessionId };
  },
};

describe("AdminAuthService", () => {
  it("seeds the owner user from bootstrap credentials and creates access and refresh tokens", async () => {
    const state = new MemoryStateStore();
    const service = createService({ state });

    const result = await service.login({
      username: "admin",
      password: "correct-password",
    });

    expect(result).toEqual({
      accessToken: "access:admin_session_fixed:admin_user_fixed:admin:owner:2026-07-26T00:15:00.000Z",
      accessTokenExpiresAt: "2026-07-26T00:15:00.000Z",
      refreshToken: "axis_refresh_refresh_fixed",
      refreshTokenExpiresAt: "2026-08-25T00:00:00.000Z",
      principal: {
        type: "admin",
        subject: "admin_user_fixed",
        username: "admin",
        role: "owner",
        scopes: ["admin:*"],
        sessionId: "admin_session_fixed",
      },
    });
    await expect(state.adminUsers.getByUsername("admin")).resolves.toMatchObject({
      id: "admin_user_fixed",
      username: "admin",
      displayName: "admin",
      role: "owner",
    });
  });

  it("rejects invalid bootstrap credentials", async () => {
    await expect(createService().login({
      username: "admin",
      password: "wrong-password",
    })).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("does not use bootstrap credentials after an owner user already exists", async () => {
    const state = new MemoryStateStore();
    const firstService = createService({ state });
    await firstService.login({ username: "admin", password: "correct-password" });
    const secondService = createService({
      state,
      bootstrapOwner: {
        username: "admin",
        password: "changed-password",
      },
    });

    await expect(secondService.login({
      username: "admin",
      password: "changed-password",
    })).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(secondService.login({
      username: "admin",
      password: "correct-password",
    })).resolves.toMatchObject({
      principal: {
        subject: "admin_user_fixed",
        username: "admin",
        role: "owner",
      },
    });
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

    expect(refreshed.refreshToken).toBe("axis_refresh_refresh_4");
    await expect(service.refresh(login.refreshToken)).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(service.verifyAccessToken(refreshed.accessToken)).resolves.toMatchObject({
      subject: "admin_user_1",
      username: "admin",
      role: "owner",
      scopes: ["admin:*"],
    });
  });

  it("rejects refresh sessions for disabled admin users", async () => {
    const state = new MemoryStateStore();
    const service = createService({ state });
    const login = await service.login({ username: "admin", password: "correct-password" });
    const user = await state.adminUsers.getByUsername("admin");
    if (!user) throw new Error("Expected bootstrap user");
    await state.adminUsers.save({
      ...user,
      disabledAt: "2026-07-26T00:01:00.000Z",
    });

    await expect(service.refresh(login.refreshToken)).rejects.toBeInstanceOf(UnauthorizedError);
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
    bootstrapOwner: {
      username: "admin",
      password: "correct-password",
    },
    accessTokens,
    ...overrides,
  });
}
