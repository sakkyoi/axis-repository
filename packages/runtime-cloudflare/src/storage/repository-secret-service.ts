import {
  NotFoundError,
  ValidationError,
  type Clock,
  type RandomId,
  type RepositorySecretRecord as StoredRepositorySecretRecord,
  type SigningKeyRecord as LegacySigningKeyRecord,
  type StateStore,
} from "@axis-repository/core";
import type {
  RepositoryActiveSecret,
  RepositorySecretCapability,
  RepositorySecretRecord,
} from "../plugins/repository-plugin-capabilities";
import type { SecretEncryption } from "./secret-encryption";

const LEGACY_APT_SIGNING_KEY_NAMESPACE = "apt.signing-key";

export class RepositorySecretService implements RepositorySecretCapability {
  constructor(
    private readonly options: {
      state: StateStore;
      clock: Clock;
      randomId: RandomId;
      encryption: SecretEncryption;
    },
  ) {}

  createSecretValue(prefix: string): string {
    return this.options.randomId.create(prefix);
  }

  async create(input: {
    namespace: string;
    repositoryName: string;
    name: string;
    publicMetadata: Record<string, unknown>;
    secrets: Record<string, string>;
  }): Promise<RepositorySecretRecord> {
    const namespace = input.namespace.trim();
    if (!namespace) throw new ValidationError("Repository secret namespace is required");
    const repositoryName = input.repositoryName.trim();
    if (!repositoryName) throw new ValidationError("Repository secret repository name is required");
    const name = input.name.trim();
    if (!name) throw new ValidationError("Repository secret name is required");
    if (await this.options.state.repositorySecrets.getByName(name, repositoryName, namespace)) {
      throw new ValidationError(`Repository secret already exists in repository ${repositoryName}: ${name}`);
    }

    const record: StoredRepositorySecretRecord = {
      id: this.options.randomId.create("repository_secret"),
      namespace,
      repositoryName,
      name,
      publicMetadata: { ...input.publicMetadata },
      encryptedSecrets: await this.options.encryption.encrypt(JSON.stringify({ ...input.secrets })),
      createdAt: this.options.clock.now().toISOString(),
    };
    await this.options.state.repositorySecrets.save(record);
    return this.toSecretRecord(record);
  }

  async list(input: { namespace: string; repositoryName?: string }): Promise<RepositorySecretRecord[]> {
    const namespace = input.namespace.trim();
    if (!namespace) throw new ValidationError("Repository secret namespace is required");
    return (await this.options.state.repositorySecrets.list())
      .map((record) => this.toSecretRecord(record))
      .filter((record) =>
        record.namespace === namespace
        && (input.repositoryName === undefined || record.repositoryName === input.repositoryName),
      );
  }

  async get(id: string): Promise<RepositorySecretRecord> {
    const record = await this.options.state.repositorySecrets.getById(id);
    if (!record) throw new NotFoundError();
    return this.toSecretRecord(record);
  }

  async getActive(id: string): Promise<RepositoryActiveSecret> {
    const record = await this.options.state.repositorySecrets.getById(id);
    if (!record) throw new NotFoundError();
    if (record.revokedAt) throw new ValidationError("Repository secret has been revoked");
    return {
      ...this.toSecretRecord(record),
      secrets: await this.decryptSecrets(record),
    };
  }

  async revoke(id: string): Promise<RepositorySecretRecord> {
    const record = await this.options.state.repositorySecrets.getById(id);
    if (!record) throw new NotFoundError();
    if (record.revokedAt) return this.toSecretRecord(record);
    if (!isRepositorySecretRecord(record)) {
      const migrated: StoredRepositorySecretRecord = {
        id: record.id,
        namespace: LEGACY_APT_SIGNING_KEY_NAMESPACE,
        repositoryName: record.repositoryName,
        name: record.name,
        publicMetadata: {
          publicKeyArmored: record.publicKeyArmored,
          fingerprint: record.fingerprint,
          keyId: record.keyId,
        },
        encryptedSecrets: await this.options.encryption.encrypt(JSON.stringify({
          privateKeyArmored: await this.options.encryption.decrypt(record.encryptedPrivateKeyArmored),
          passphrase: await this.options.encryption.decrypt(record.encryptedPassphrase),
        })),
        createdAt: record.createdAt,
        revokedAt: this.options.clock.now().toISOString(),
      };
      await this.options.state.repositorySecrets.save(migrated);
      return this.toSecretRecord(migrated);
    }
    const revoked: StoredRepositorySecretRecord = { ...record, revokedAt: this.options.clock.now().toISOString() };
    await this.options.state.repositorySecrets.save(revoked);
    return this.toSecretRecord(revoked);
  }

  private toSecretRecord(record: StoredRepositorySecretRecord | LegacySigningKeyRecord): RepositorySecretRecord {
    if (!isRepositorySecretRecord(record)) {
      return {
        id: record.id,
        namespace: LEGACY_APT_SIGNING_KEY_NAMESPACE,
        repositoryName: record.repositoryName,
        name: record.name,
        publicMetadata: {
          publicKeyArmored: record.publicKeyArmored,
          fingerprint: record.fingerprint,
          keyId: record.keyId,
        },
        createdAt: record.createdAt,
        revokedAt: record.revokedAt ?? null,
      };
    }
    return {
      id: record.id,
      namespace: record.namespace,
      repositoryName: record.repositoryName,
      name: record.name,
      publicMetadata: { ...record.publicMetadata },
      createdAt: record.createdAt,
      revokedAt: record.revokedAt ?? null,
    };
  }

  private async decryptSecrets(record: StoredRepositorySecretRecord | LegacySigningKeyRecord): Promise<Record<string, string>> {
    if (isRepositorySecretRecord(record)) {
      const decrypted = await this.options.encryption.decrypt(record.encryptedSecrets);
      const parsed = JSON.parse(decrypted) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new ValidationError("Repository secret payload is invalid");
      }
      const secrets = parsed as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(secrets).map(([key, value]) => [key, secretString(value)]),
      );
    }
    return {
      privateKeyArmored: await this.options.encryption.decrypt(record.encryptedPrivateKeyArmored),
      passphrase: await this.options.encryption.decrypt(record.encryptedPassphrase),
    };
  }
}

function isRepositorySecretRecord(
  record: StoredRepositorySecretRecord | LegacySigningKeyRecord,
): record is StoredRepositorySecretRecord {
  return "namespace" in record;
}

function secretString(value: unknown): string {
  if (typeof value !== "string" || !value) {
    throw new ValidationError("Repository secret payload contains a non-string value");
  }
  return value;
}
