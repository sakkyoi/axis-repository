import type { AdminPrincipal, PrincipalRef, PublishTokenRecord, TokenPrincipal } from "../domain/domain";
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from "../domain/errors";
import { tokenLookupId } from "../domain/tokens";
import type { Clock, RandomId, SecretHasher, StateStore } from "../ports/ports";

// Records are snapshotted by the state store on write and on read, so callers
// can never reach stored state through what they are handed back. Copying again
// here would be a second, divergent implementation of the same invariant.

/**
 * Fills in fields added after some records were written. Records stored before
 * signing key scopes existed have no signingKeyIds.
 */
function withScopeDefaults(record: PublishTokenRecord): PublishTokenRecord {
  return record.signingKeyIds ? record : { ...record, signingKeyIds: [] };
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

const PUBLISH_TOKEN_PREFIX = "axis_publish_";

function publishTokenSecret(tokenId: string, randomPart: string): string {
  return `${PUBLISH_TOKEN_PREFIX}${tokenId}.${randomPart}`;
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
    const secret = publishTokenSecret(tokenId, this.options.randomId.create("tok"));
    const record: PublishTokenRecord = {
      id: tokenId,
      name,
      tokenHash: await this.options.hasher.hash(secret),
      permissions: input.permissions,
      repositories: input.repositories,
      ecosystemScopes: input.ecosystemScopes,
      signingKeyIds: input.signingKeyIds ?? [],
      ...(input.owner ? { owner: input.owner } : {}),
      createdAt: this.options.clock.now().toISOString(),
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    };
    await this.options.state.publishTokens.save(record);
    return { record: record, secret };
  }

  async list(): Promise<PublishTokenRecord[]> {
    return (await this.options.state.publishTokens.list()).map(withScopeDefaults);
  }

  async getByName(name: string): Promise<PublishTokenRecord> {
    const record = await this.options.state.publishTokens.getByName(name);
    if (!record) {
      throw new NotFoundError(`Publish token not found: ${name}`);
    }
    return record;
  }

  async revoke(name: string): Promise<PublishTokenRecord> {
    const record = await this.options.state.publishTokens.getByName(name);
    if (!record) {
      throw new NotFoundError(`Publish token not found: ${name}`);
    }
    if (record.revokedAt) {
      return record;
    }
    const revoked: PublishTokenRecord = {
      ...record,
      revokedAt: this.options.clock.now().toISOString(),
    };
    await this.options.state.publishTokens.save(revoked);
    return revoked;
  }

  async rotate(name: string): Promise<RotatePublishTokenResult> {
    const record = await this.options.state.publishTokens.getByName(name);
    if (!record) {
      throw new NotFoundError(`Publish token not found: ${name}`);
    }
    if (record.revokedAt) {
      throw new ValidationError("Publish token has been revoked");
    }
    const secret = publishTokenSecret(record.id, this.options.randomId.create("tok"));
    const rotated: PublishTokenRecord = {
      ...record,
      tokenHash: await this.options.hasher.hash(secret),
      rotatedAt: this.options.clock.now().toISOString(),
    };
    await this.options.state.publishTokens.save(rotated);
    return { record: rotated, secret };
  }

  async delete(name: string): Promise<void> {
    const deleted = await this.options.state.publishTokens.deleteByName(name);
    if (!deleted) {
      throw new NotFoundError(`Publish token not found: ${name}`);
    }
  }

  async verify(secret: string): Promise<TokenPrincipal> {
    const record = await this.findRecordForSecret(secret);
    if (record) {
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
        permissions: record.permissions,
        repositories: record.repositories,
        ecosystemScopes: record.ecosystemScopes,
        signingKeyIds: record.signingKeyIds ?? [],
        ...(record.owner ? { owner: record.owner } : {}),
      };
    }
    throw new UnauthorizedError();
  }

  private async findRecordForSecret(secret: string): Promise<PublishTokenRecord | null> {
    const tokenId = tokenLookupId(secret, PUBLISH_TOKEN_PREFIX);
    if (tokenId) {
      const record = await this.options.state.publishTokens.getById(tokenId);
      if (record && await this.options.hasher.verify(secret, record.tokenHash)) {
        return record;
      }
      return null;
    }
    // Secrets issued before the id was embedded carry no lookup key.
    for (const record of await this.options.state.publishTokens.list()) {
      if (await this.options.hasher.verify(secret, record.tokenHash)) {
        return record;
      }
    }
    return null;
  }
}
