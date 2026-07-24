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

const APT_SIGNING_KEY_NAMESPACE = "apt.signing-key";

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
    this.requireSupportedNamespace(input.namespace);
    const repositoryName = input.repositoryName.trim();
    if (!repositoryName) throw new ValidationError("Repository secret repository name is required");
    const name = input.name.trim();
    if (!name) throw new ValidationError("Repository secret name is required");
    if (await this.options.state.signingKeys.getByName(name, repositoryName)) {
      throw new ValidationError(`Repository secret already exists in repository ${repositoryName}: ${name}`);
    }

    const publicKeyArmored = stringMetadata(input.publicMetadata, "publicKeyArmored");
    const fingerprint = stringMetadata(input.publicMetadata, "fingerprint");
    const keyId = stringMetadata(input.publicMetadata, "keyId");
    if ((await this.options.state.signingKeys.list()).some((record) => record.fingerprint === fingerprint)) {
      throw new ValidationError(`Repository secret already exists with fingerprint: ${fingerprint}`);
    }

    const record: SigningKeyRecord = {
      id: this.options.randomId.create("signing_key"),
      repositoryName,
      name,
      publicKeyArmored,
      encryptedPrivateKeyArmored: await this.options.encryption.encrypt(secretValue(input.secrets, "privateKeyArmored")),
      encryptedPassphrase: await this.options.encryption.encrypt(secretValue(input.secrets, "passphrase")),
      fingerprint,
      keyId,
      createdAt: this.options.clock.now().toISOString(),
    };
    await this.options.state.signingKeys.save(record);
    return this.toSecretRecord(record);
  }

  async list(input: { namespace: string; repositoryName?: string }): Promise<RepositorySecretRecord[]> {
    this.requireSupportedNamespace(input.namespace);
    return (await this.options.state.signingKeys.list())
      .filter((record) => input.repositoryName === undefined || record.repositoryName === input.repositoryName)
      .map((record) => this.toSecretRecord(record));
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
      secrets: {
        privateKeyArmored: await this.options.encryption.decrypt(record.encryptedPrivateKeyArmored),
        passphrase: await this.options.encryption.decrypt(record.encryptedPassphrase),
      },
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

  private requireSupportedNamespace(namespace: string): void {
    if (namespace !== APT_SIGNING_KEY_NAMESPACE) {
      throw new ValidationError(`Repository secret namespace is not supported: ${namespace}`);
    }
  }

  private toSecretRecord(record: SigningKeyRecord): RepositorySecretRecord {
    return {
      id: record.id,
      namespace: APT_SIGNING_KEY_NAMESPACE,
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
}

function stringMetadata(metadata: Record<string, unknown>, key: string): string {
  const value = metadata[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new ValidationError(`Repository secret publicMetadata.${key} is required`);
  }
  return value;
}

function secretValue(secrets: Record<string, string>, key: string): string {
  const value = secrets[key];
  if (typeof value !== "string" || !value) {
    throw new ValidationError(`Repository secret secrets.${key} is required`);
  }
  return value;
}
