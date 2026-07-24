import {
  NotFoundError,
  ValidationError,
  type Clock,
  type RandomId,
  type SigningKeyRecord,
  type StateStore,
} from "@axis-repository/core";
import type {
  RepositoryActiveSecret,
  RepositorySecretCapability,
  RepositorySecretRecord,
} from "./repository-runtime-plugin-registry";
import type { SecretEncryption } from "./secret-encryption";

const LEGACY_APT_SIGNING_KEY_NAMESPACE = "apt.signing-key";
const STORED_SECRET_VERSION = 1;

interface StoredRepositorySecretMetadata {
  axisRepositorySecret: typeof STORED_SECRET_VERSION;
  namespace: string;
  publicMetadata: Record<string, unknown>;
}

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
    if (await this.options.state.signingKeys.getByName(name, repositoryName)) {
      throw new ValidationError(`Repository secret already exists in repository ${repositoryName}: ${name}`);
    }

    const record: SigningKeyRecord = {
      id: this.options.randomId.create("repository_secret"),
      repositoryName,
      name,
      publicKeyArmored: JSON.stringify({
        axisRepositorySecret: STORED_SECRET_VERSION,
        namespace,
        publicMetadata: { ...input.publicMetadata },
      } satisfies StoredRepositorySecretMetadata),
      encryptedPrivateKeyArmored: await this.options.encryption.encrypt(JSON.stringify({ ...input.secrets })),
      encryptedPassphrase: await this.options.encryption.encrypt(""),
      fingerprint: `${namespace}:${repositoryName}:${name}`,
      keyId: namespace,
      createdAt: this.options.clock.now().toISOString(),
    };
    await this.options.state.signingKeys.save(record);
    return this.toSecretRecord(record);
  }

  async list(input: { namespace: string; repositoryName?: string }): Promise<RepositorySecretRecord[]> {
    const namespace = input.namespace.trim();
    if (!namespace) throw new ValidationError("Repository secret namespace is required");
    return (await this.options.state.signingKeys.list())
      .map((record) => this.toSecretRecord(record))
      .filter((record) =>
        record.namespace === namespace
        && (input.repositoryName === undefined || record.repositoryName === input.repositoryName),
      );
  }

  async get(id: string): Promise<RepositorySecretRecord> {
    const record = await this.options.state.signingKeys.getById(id);
    if (!record) throw new NotFoundError();
    return this.toSecretRecord(record);
  }

  async getActive(id: string): Promise<RepositoryActiveSecret> {
    const record = await this.options.state.signingKeys.getById(id);
    if (!record) throw new NotFoundError();
    if (record.revokedAt) throw new ValidationError("Repository secret has been revoked");
    return {
      ...this.toSecretRecord(record),
      secrets: await this.decryptSecrets(record),
    };
  }

  async revoke(id: string): Promise<RepositorySecretRecord> {
    const record = await this.options.state.signingKeys.getById(id);
    if (!record) throw new NotFoundError();
    if (record.revokedAt) return this.toSecretRecord(record);
    const revoked: SigningKeyRecord = { ...record, revokedAt: this.options.clock.now().toISOString() };
    await this.options.state.signingKeys.save(revoked);
    return this.toSecretRecord(revoked);
  }

  private toSecretRecord(record: SigningKeyRecord): RepositorySecretRecord {
    const metadata = decodeStoredMetadata(record);
    return {
      id: record.id,
      namespace: metadata.namespace,
      repositoryName: record.repositoryName,
      name: record.name,
      publicMetadata: metadata.publicMetadata,
      createdAt: record.createdAt,
      revokedAt: record.revokedAt ?? null,
    };
  }

  private async decryptSecrets(record: SigningKeyRecord): Promise<Record<string, string>> {
    if (isStoredRepositorySecretMetadata(record)) {
      const decrypted = await this.options.encryption.decrypt(record.encryptedPrivateKeyArmored);
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

function decodeStoredMetadata(record: SigningKeyRecord): StoredRepositorySecretMetadata {
  if (isStoredRepositorySecretMetadata(record)) {
    return JSON.parse(record.publicKeyArmored) as StoredRepositorySecretMetadata;
  }
  return {
    axisRepositorySecret: STORED_SECRET_VERSION,
    namespace: LEGACY_APT_SIGNING_KEY_NAMESPACE,
    publicMetadata: {
      publicKeyArmored: record.publicKeyArmored,
      fingerprint: record.fingerprint,
      keyId: record.keyId,
    },
  };
}

function isStoredRepositorySecretMetadata(record: SigningKeyRecord): boolean {
  try {
    const parsed = JSON.parse(record.publicKeyArmored) as unknown;
    return Boolean(
      parsed
      && typeof parsed === "object"
      && !Array.isArray(parsed)
      && (parsed as Record<string, unknown>).axisRepositorySecret === STORED_SECRET_VERSION,
    );
  } catch {
    return false;
  }
}

function secretString(value: unknown): string {
  if (typeof value !== "string" || !value) {
    throw new ValidationError("Repository secret payload contains a non-string value");
  }
  return value;
}
