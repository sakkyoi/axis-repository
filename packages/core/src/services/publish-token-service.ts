import type { AdminPrincipal, PrincipalRef, PublishTokenRecord, TokenPrincipal } from "../domain/domain";
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from "../domain/errors";
import type { Clock, RandomId, SecretHasher, StateStore } from "../ports/ports";

function cloneRecord(input: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
}

function copyRecord(record: PublishTokenRecord): PublishTokenRecord {
  const signingKeyIds = record.signingKeyIds ?? [];
  return {
    ...record,
    permissions: [...record.permissions],
    repositories: [...record.repositories],
    ecosystemScopes: cloneRecord(record.ecosystemScopes),
    signingKeyIds: [...signingKeyIds],
    ...(record.owner ? { owner: { ...record.owner } } : {}),
  };
}

export function principalRefFromAdminPrincipal(principal: AdminPrincipal): PrincipalRef {
  return {
    type: "admin-user",
    subject: principal.subject,
    displayName: principal.username,
  };
}

export interface CreatePublishTokenInput {
  name: string;
  permissions: string[];
  repositories: string[];
  ecosystemScopes: Record<string, unknown>;
  signingKeyIds?: string[];
  owner?: PrincipalRef;
  expiresAt?: string;
}

export interface CreatePublishTokenResult {
  record: PublishTokenRecord;
  secret: string;
}

export interface RotatePublishTokenResult {
  record: PublishTokenRecord;
  secret: string;
}

export interface PublishTokenServiceOptions {
  state: StateStore;
  clock: Clock;
  randomId: RandomId;
  hasher: SecretHasher;
}

export class PublishTokenService {
  constructor(private readonly options: PublishTokenServiceOptions) {}

  async create(input: CreatePublishTokenInput): Promise<CreatePublishTokenResult> {
    const name = input.name.trim();
    if (!name) {
      throw new ValidationError("Publish token name is required");
    }
    if (await this.options.state.publishTokens.getByName(name)) {
      throw new ValidationError(`Publish token already exists: ${name}`);
    }
    if (input.permissions.length === 0) {
      throw new ValidationError("Publish token must include at least one permission");
    }
    if (input.repositories.length === 0) {
      throw new ValidationError("Publish token must be scoped to at least one repository");
    }
    if (input.expiresAt !== undefined && !Number.isFinite(Date.parse(input.expiresAt))) {
      throw new ValidationError("Publish token expiresAt must be a valid date");
    }

    const tokenId = this.options.randomId.create("ptok");
    const secret = `axis_publish_${this.options.randomId.create("tok")}`;
    const record: PublishTokenRecord = {
      id: tokenId,
      name,
      tokenHash: await this.options.hasher.hash(secret),
      permissions: [...input.permissions],
      repositories: [...input.repositories],
      ecosystemScopes: cloneRecord(input.ecosystemScopes),
      signingKeyIds: [...(input.signingKeyIds ?? [])],
      ...(input.owner ? { owner: { ...input.owner } } : {}),
      createdAt: this.options.clock.now().toISOString(),
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    };
    await this.options.state.publishTokens.save(record);
    return { record: copyRecord(record), secret };
  }

  async list(): Promise<PublishTokenRecord[]> {
    const records = await this.options.state.publishTokens.list();
    return records.map(copyRecord);
  }

  async getByName(name: string): Promise<PublishTokenRecord> {
    const record = await this.options.state.publishTokens.getByName(name);
    if (!record) {
      throw new NotFoundError(`Publish token not found: ${name}`);
    }
    return copyRecord(record);
  }

  async revoke(name: string): Promise<PublishTokenRecord> {
    const record = await this.options.state.publishTokens.getByName(name);
    if (!record) {
      throw new NotFoundError(`Publish token not found: ${name}`);
    }
    if (record.revokedAt) {
      return copyRecord(record);
    }
    const revoked: PublishTokenRecord = {
      ...record,
      revokedAt: this.options.clock.now().toISOString(),
    };
    await this.options.state.publishTokens.save(revoked);
    return copyRecord(revoked);
  }

  async rotate(name: string): Promise<RotatePublishTokenResult> {
    const record = await this.options.state.publishTokens.getByName(name);
    if (!record) {
      throw new NotFoundError(`Publish token not found: ${name}`);
    }
    if (record.revokedAt) {
      throw new ValidationError("Publish token has been revoked");
    }
    const secret = `axis_publish_${this.options.randomId.create("tok")}`;
    const rotated: PublishTokenRecord = {
      ...record,
      tokenHash: await this.options.hasher.hash(secret),
      rotatedAt: this.options.clock.now().toISOString(),
    };
    await this.options.state.publishTokens.save(rotated);
    return { record: copyRecord(rotated), secret };
  }

  async delete(name: string): Promise<void> {
    const deleted = await this.options.state.publishTokens.deleteByName(name);
    if (!deleted) {
      throw new NotFoundError(`Publish token not found: ${name}`);
    }
  }

  async verify(secret: string): Promise<TokenPrincipal> {
    const records = await this.options.state.publishTokens.list();
    for (const record of records) {
      if (!(await this.options.hasher.verify(secret, record.tokenHash))) continue;
      if (record.revokedAt) {
        throw new ForbiddenError("Publish token has been revoked");
      }
      if (record.expiresAt) {
        const expiresAt = Date.parse(record.expiresAt);
        if (!Number.isFinite(expiresAt)) {
          throw new ForbiddenError("Publish token has invalid expiration");
        }
        if (expiresAt <= this.options.clock.now().getTime()) {
          throw new ForbiddenError("Publish token has expired");
        }
      }
      return {
        tokenId: record.id,
        name: record.name,
        permissions: [...record.permissions],
        repositories: [...record.repositories],
        ecosystemScopes: cloneRecord(record.ecosystemScopes),
        signingKeyIds: [...(record.signingKeyIds ?? [])],
        ...(record.owner ? { owner: { ...record.owner } } : {}),
      };
    }
    throw new UnauthorizedError();
  }
}
