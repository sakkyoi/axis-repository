import type { AdminPrincipal, AdminRefreshSessionRecord } from "../domain/domain";
import { UnauthorizedError } from "../domain/errors";
import type { AdminAccessTokenCodec, AdminPasswordVerifier, Clock, RandomId, SecretHasher, StateStore } from "../ports/ports";

export interface AdminAuthServiceOptions {
  state: StateStore;
  clock: Clock;
  randomId: RandomId;
  hasher: SecretHasher;
  passwordVerifier: AdminPasswordVerifier;
  accessTokens: AdminAccessTokenCodec;
  accessTokenTtlSeconds?: number;
  refreshTokenTtlSeconds?: number;
}

export interface AdminAuthTokenSet {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  principal: AdminPrincipal;
}

export class AdminAuthService {
  constructor(private readonly options: AdminAuthServiceOptions) {}

  async login(input: { username: string; password: string }): Promise<AdminAuthTokenSet> {
    if (!(await this.options.passwordVerifier.verify(input.username, input.password))) {
      throw new UnauthorizedError();
    }
    const sessionId = this.options.randomId.create("admin_session");
    return this.createTokenSet({
      sessionId,
      subject: input.username,
      scopes: ["admin:*"],
      createdAt: this.options.clock.now(),
    });
  }

  async refresh(refreshToken: string): Promise<AdminAuthTokenSet> {
    const session = await this.findValidRefreshSession(refreshToken);
    return this.createTokenSet({
      sessionId: session.id,
      subject: session.subject,
      scopes: session.scopes,
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

  verifyAccessToken(token: string): Promise<AdminPrincipal> {
    return this.options.accessTokens.verify(token);
  }

  private async createTokenSet(input: {
    sessionId: string;
    subject: string;
    scopes: string[];
    createdAt: Date;
    rotatedAt?: Date;
  }): Promise<AdminAuthTokenSet> {
    const now = this.options.clock.now();
    const accessTokenExpiresAt = new Date(now.getTime() + this.accessTokenTtlMs());
    const refreshTokenExpiresAt = new Date(now.getTime() + this.refreshTokenTtlMs());
    const refreshToken = `axis_refresh_${this.options.randomId.create("refresh")}`;
    const principal: AdminPrincipal = {
      type: "admin",
      subject: input.subject,
      scopes: [...input.scopes],
      sessionId: input.sessionId,
    };
    const session: AdminRefreshSessionRecord = {
      id: input.sessionId,
      subject: input.subject,
      tokenHash: await this.options.hasher.hash(refreshToken),
      scopes: [...input.scopes],
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
    for (const session of await this.options.state.adminRefreshSessions.list()) {
      if (!(await this.options.hasher.verify(refreshToken, session.tokenHash))) continue;
      if (session.revokedAt || Date.parse(session.expiresAt) <= this.options.clock.now().getTime()) {
        throw new UnauthorizedError();
      }
      return session;
    }
    throw new UnauthorizedError();
  }

  private accessTokenTtlMs(): number {
    return (this.options.accessTokenTtlSeconds ?? 15 * 60) * 1000;
  }

  private refreshTokenTtlMs(): number {
    return (this.options.refreshTokenTtlSeconds ?? 30 * 24 * 60 * 60) * 1000;
  }
}
