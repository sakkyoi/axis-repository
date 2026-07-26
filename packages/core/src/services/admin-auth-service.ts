import type { AdminPrincipal, AdminRefreshSessionRecord, AdminUserRecord } from "../domain/domain";
import { UnauthorizedError, ValidationError } from "../domain/errors";
import { tokenLookupId } from "../domain/tokens";
import type { AdminAccessTokenCodec, Clock, PasswordHasher, RandomId, SecretHasher, StateStore } from "../ports/ports";

export interface BootstrapOwnerCredentials {
  username: string;
  displayName?: string;
  password?: string;
  passwordHash?: string;
}

export interface AdminAuthServiceOptions {
  state: StateStore;
  clock: Clock;
  randomId: RandomId;
  /** Digests refresh tokens. */
  hasher: SecretHasher;
  /** Digests admin passwords. */
  passwordHasher: PasswordHasher;
  bootstrapOwner?: BootstrapOwnerCredentials;
  accessTokens: AdminAccessTokenCodec;
  accessTokenTtlSeconds?: number;
  refreshTokenTtlSeconds?: number;
  /** Hard cap on how long one session can be extended by refreshing. */
  sessionAbsoluteTtlSeconds?: number;
}

export interface AdminAuthTokenSet {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  principal: AdminPrincipal;
}

export const ADMIN_PASSWORD_MIN_LENGTH = 8;

const REFRESH_TOKEN_PREFIX = "axis_refresh_";

export class AdminAuthService {
  constructor(private readonly options: AdminAuthServiceOptions) {}

  async login(input: { username: string; password: string }): Promise<AdminAuthTokenSet> {
    await this.ensureBootstrapOwner();
    const user = await this.options.state.adminUsers.getByUsername(input.username);
    if (!user || user.disabledAt || !(await this.options.passwordHasher.verify(input.password, user.passwordHash))) {
      throw new UnauthorizedError();
    }
    const sessionId = this.options.randomId.create("admin_session");
    return this.createTokenSetForUser({
      sessionId,
      user: await this.upgradePasswordHashIfNeeded(user, input.password),
      createdAt: this.options.clock.now(),
    });
  }

  /**
   * Rewrites a password hash stored under weaker parameters. This is the only
   * moment the plaintext is available, so a deployment migrating to a stronger
   * KDF converts each account on its owner's next successful sign-in.
   */
  private async upgradePasswordHashIfNeeded(
    user: AdminUserRecord,
    password: string,
  ): Promise<AdminUserRecord> {
    if (!this.options.passwordHasher.needsRehash(user.passwordHash)) {
      return user;
    }
    const upgraded: AdminUserRecord = {
      ...user,
      passwordHash: await this.options.passwordHasher.hash(password),
      updatedAt: this.options.clock.now().toISOString(),
    };
    await this.options.state.adminUsers.save(upgraded);
    return upgraded;
  }

  async refresh(refreshToken: string): Promise<AdminAuthTokenSet> {
    const session = await this.findValidRefreshSession(refreshToken);
    // A sliding window with no ceiling means one session can be extended
    // indefinitely, so cap it against the time it was first created.
    const sessionAgeMs = this.options.clock.now().getTime() - Date.parse(session.createdAt);
    if (sessionAgeMs >= this.sessionAbsoluteTtlMs()) {
      throw new UnauthorizedError();
    }
    const user = await this.options.state.adminUsers.getById(session.subject);
    if (!user || user.disabledAt) {
      throw new UnauthorizedError();
    }
    return this.createTokenSetForUser({
      sessionId: session.id,
      user,
      createdAt: new Date(session.createdAt),
      rotatedAt: this.options.clock.now(),
    });
  }

  async logout(refreshToken: string): Promise<void> {
    const session = await this.findValidRefreshSession(refreshToken);
    await this.options.state.adminRefreshSessions.save({
      ...session,
      revokedAt: this.options.clock.now().toISOString(),
    });
  }

  /**
   * Verifies the signed token and then checks that its session is still live.
   *
   * Without the session check, logging out or changing a password would leave
   * previously issued access tokens usable for the rest of their lifetime. The
   * principal carries sessionId precisely so this is possible.
   */
  async verifyAccessToken(token: string): Promise<AdminPrincipal> {
    const principal = await this.options.accessTokens.verify(token);
    const session = await this.options.state.adminRefreshSessions.get(principal.sessionId);
    if (!session || session.revokedAt) {
      throw new UnauthorizedError();
    }
    if (Date.parse(session.expiresAt) <= this.options.clock.now().getTime()) {
      throw new UnauthorizedError();
    }
    return principal;
  }

  async changeOwnPassword(
    principal: AdminPrincipal,
    input: { currentPassword: string; newPassword: string },
  ): Promise<void> {
    const newPassword = input.newPassword.trim();
    if (newPassword.length < ADMIN_PASSWORD_MIN_LENGTH) {
      throw new ValidationError(`newPassword must be at least ${ADMIN_PASSWORD_MIN_LENGTH} characters`);
    }
    const user = await this.options.state.adminUsers.getById(principal.subject);
    if (!user || user.disabledAt || !(await this.options.passwordHasher.verify(input.currentPassword, user.passwordHash))) {
      throw new UnauthorizedError();
    }
    const now = this.options.clock.now().toISOString();
    await this.options.state.adminUsers.save({
      ...user,
      passwordHash: await this.options.passwordHasher.hash(newPassword),
      updatedAt: now,
    });
    await this.revokeRefreshSessionsForSubject(user.id, now);
  }

  async listUsers(): Promise<AdminUserRecord[]> {
    // Deliberately does not seed: this is a read, and seeding here made an
    // empty store surface as UnauthorizedError from a list query.
    return this.options.state.adminUsers.list();
  }

  private async ensureBootstrapOwner(): Promise<void> {
    if ((await this.options.state.adminUsers.list()).length > 0) {
      return;
    }
    const bootstrap = this.options.bootstrapOwner;
    const username = bootstrap?.username.trim() ?? "";
    if (!username) {
      throw new UnauthorizedError();
    }
    if (!bootstrap?.passwordHash && !bootstrap?.password) {
      throw new UnauthorizedError();
    }
    // A bootstrap password becomes the owner's real password, so hold it to the
    // same minimum as a password change. A precomputed hash is exempt: its
    // strength was decided wherever it was generated.
    if (!bootstrap.passwordHash && (bootstrap.password ?? "").length < ADMIN_PASSWORD_MIN_LENGTH) {
      throw new ValidationError(
        `Bootstrap admin password must be at least ${ADMIN_PASSWORD_MIN_LENGTH} characters`,
      );
    }
    const now = this.options.clock.now().toISOString();
    await this.options.state.adminUsers.save({
      id: this.options.randomId.create("admin_user"),
      username,
      displayName: bootstrap.displayName?.trim() || username,
      passwordHash: bootstrap.passwordHash ?? await this.options.passwordHasher.hash(bootstrap.password ?? ""),
      role: "owner",
      createdAt: now,
      updatedAt: now,
    });
  }

  private async createTokenSetForUser(input: {
    sessionId: string;
    user: AdminUserRecord;
    createdAt: Date;
    rotatedAt?: Date;
  }): Promise<AdminAuthTokenSet> {
    const now = this.options.clock.now();
    const accessTokenExpiresAt = new Date(now.getTime() + this.accessTokenTtlMs());
    const refreshTokenExpiresAt = new Date(now.getTime() + this.refreshTokenTtlMs());
    const refreshToken = `${REFRESH_TOKEN_PREFIX}${input.sessionId}.${this.options.randomId.create("refresh")}`;
    const scopes = scopesForRole(input.user.role);
    const principal: AdminPrincipal = {
      type: "admin",
      subject: input.user.id,
      username: input.user.username,
      role: input.user.role,
      scopes,
      sessionId: input.sessionId,
    };
    const session: AdminRefreshSessionRecord = {
      id: input.sessionId,
      subject: input.user.id,
      username: input.user.username,
      role: input.user.role,
      tokenHash: await this.options.hasher.hash(refreshToken),
      scopes,
      createdAt: input.createdAt.toISOString(),
      expiresAt: refreshTokenExpiresAt.toISOString(),
      ...(input.rotatedAt ? { rotatedAt: input.rotatedAt.toISOString() } : {}),
    };
    await this.options.state.adminRefreshSessions.save(session);
    return {
      accessToken: await this.options.accessTokens.create(principal, accessTokenExpiresAt),
      accessTokenExpiresAt: accessTokenExpiresAt.toISOString(),
      refreshToken,
      refreshTokenExpiresAt: refreshTokenExpiresAt.toISOString(),
      principal,
    };
  }

  private async findValidRefreshSession(refreshToken: string): Promise<AdminRefreshSessionRecord> {
    const session = await this.findRefreshSession(refreshToken);
    if (!session) {
      throw new UnauthorizedError();
    }
    if (session.revokedAt || Date.parse(session.expiresAt) <= this.options.clock.now().getTime()) {
      throw new UnauthorizedError();
    }
    return session;
  }

  private async findRefreshSession(refreshToken: string): Promise<AdminRefreshSessionRecord | null> {
    const sessionId = tokenLookupId(refreshToken, REFRESH_TOKEN_PREFIX);
    if (sessionId) {
      const session = await this.options.state.adminRefreshSessions.get(sessionId);
      if (session && await this.options.hasher.verify(refreshToken, session.tokenHash)) {
        return session;
      }
      return null;
    }
    // Tokens issued before the session id was embedded carry no lookup key.
    for (const session of await this.options.state.adminRefreshSessions.list()) {
      if (await this.options.hasher.verify(refreshToken, session.tokenHash)) {
        return session;
      }
    }
    return null;
  }

  private async revokeRefreshSessionsForSubject(subject: string, revokedAt: string): Promise<void> {
    for (const session of await this.options.state.adminRefreshSessions.list()) {
      if (session.subject !== subject || session.revokedAt) continue;
      await this.options.state.adminRefreshSessions.save({
        ...session,
        revokedAt,
      });
    }
  }

  private accessTokenTtlMs(): number {
    return (this.options.accessTokenTtlSeconds ?? 15 * 60) * 1000;
  }

  private refreshTokenTtlMs(): number {
    return (this.options.refreshTokenTtlSeconds ?? 30 * 24 * 60 * 60) * 1000;
  }

  private sessionAbsoluteTtlMs(): number {
    return (this.options.sessionAbsoluteTtlSeconds ?? 90 * 24 * 60 * 60) * 1000;
  }
}

function scopesForRole(role: AdminUserRecord["role"]): string[] {
  if (role === "owner") {
    return ["admin:*"];
  }
  return [];
}
