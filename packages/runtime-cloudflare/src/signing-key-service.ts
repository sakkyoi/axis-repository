import {
  NotFoundError,
  ValidationError,
  type Clock,
  type RandomId,
  type SigningKeyRecord,
  type StateStore,
} from "@axis-repository/core";
import { decryptKey, generateKey, readPrivateKey } from "openpgp";
import type { SecretEncryption } from "./secret-encryption";

export interface PublicSigningKey {
  id: string;
  repositoryName: string;
  name: string;
  publicKeyArmored: string;
  fingerprint: string;
  keyId: string;
  createdAt: string;
  revokedAt: string | null;
}

export interface ActivePrivateSigningKey {
  id: string;
  repositoryName: string;
  privateKeyArmored: string;
  passphrase: string;
  fingerprint: string;
  keyId: string;
}

export class SigningKeyService {
  constructor(
    private readonly options: {
      state: StateStore;
      clock: Clock;
      randomId: RandomId;
      encryption: SecretEncryption;
    },
  ) {}

  async create(input: { repositoryName: string; name: string; privateKeyArmored: string; passphrase: string }): Promise<PublicSigningKey> {
    const repositoryName = input.repositoryName.trim();
    if (!repositoryName) throw new ValidationError("Signing key repository name is required");
    const name = input.name.trim();
    if (!name) throw new ValidationError("Signing key name is required");
    if (await this.options.state.signingKeys.getByName(name, repositoryName)) {
      throw new ValidationError(`Signing key already exists in repository ${repositoryName}: ${name}`);
    }

    const privateKey = await this.readAndDecryptPrivateKey(input.privateKeyArmored, input.passphrase);
    const fingerprint = privateKey.getFingerprint().toUpperCase();
    if ((await this.options.state.signingKeys.list()).some((record) => record.fingerprint === fingerprint)) {
      throw new ValidationError(`Signing key already exists with fingerprint: ${fingerprint}`);
    }

    const publicKeyArmored = privateKey.toPublic().armor();
    const record: SigningKeyRecord = {
      id: this.options.randomId.create("signing_key"),
      repositoryName,
      name,
      publicKeyArmored,
      encryptedPrivateKeyArmored: await this.options.encryption.encrypt(input.privateKeyArmored),
      encryptedPassphrase: await this.options.encryption.encrypt(input.passphrase),
      fingerprint,
      keyId: privateKey.getKeyID().toHex().toUpperCase(),
      createdAt: this.options.clock.now().toISOString(),
    };
    await this.options.state.signingKeys.save(record);
    return this.toPublic(record);
  }

  async generate(input: { repositoryName: string; name: string; userIdName: string; userIdEmail: string }): Promise<PublicSigningKey> {
    const userIdName = input.userIdName.trim();
    const userIdEmail = input.userIdEmail.trim();
    if (!userIdName) throw new ValidationError("Signing key user ID name is required");
    if (!userIdEmail) throw new ValidationError("Signing key user ID email is required");

    const passphrase = this.options.randomId.create("pgp_passphrase");
    const key = await generateKey({
      type: "ecc",
      curve: "curve25519Legacy",
      userIDs: [{ name: userIdName, email: userIdEmail }],
      passphrase,
    });
    return this.create({
      repositoryName: input.repositoryName,
      name: input.name,
      privateKeyArmored: key.privateKey,
      passphrase,
    });
  }

  async list(): Promise<PublicSigningKey[]> {
    return (await this.options.state.signingKeys.list()).map((record) => this.toPublic(record));
  }

  async listForRepository(repositoryName: string): Promise<PublicSigningKey[]> {
    return (await this.options.state.signingKeys.list())
      .filter((record) => record.repositoryName === repositoryName)
      .map((record) => this.toPublic(record));
  }

  async revoke(id: string): Promise<PublicSigningKey> {
    const record = await this.options.state.signingKeys.getById(id);
    if (!record) throw new NotFoundError();
    if (record.revokedAt) return this.toPublic(record);

    const revoked: SigningKeyRecord = { ...record, revokedAt: this.options.clock.now().toISOString() };
    await this.options.state.signingKeys.save(revoked);
    return this.toPublic(revoked);
  }

  async getPublicKey(id: string): Promise<PublicSigningKey> {
    const record = await this.options.state.signingKeys.getById(id);
    if (!record) throw new NotFoundError();
    return this.toPublic(record);
  }

  async getActivePrivateKey(id: string): Promise<ActivePrivateSigningKey> {
    const record = await this.options.state.signingKeys.getById(id);
    if (!record) throw new NotFoundError();
    if (record.revokedAt) throw new ValidationError("Signing key has been revoked");
    return {
      id: record.id,
      repositoryName: record.repositoryName,
      privateKeyArmored: await this.options.encryption.decrypt(record.encryptedPrivateKeyArmored),
      passphrase: await this.options.encryption.decrypt(record.encryptedPassphrase),
      fingerprint: record.fingerprint,
      keyId: record.keyId,
    };
  }

  private async readAndDecryptPrivateKey(privateKeyArmored: string, passphrase: string) {
    try {
      const privateKey = await readPrivateKey({ armoredKey: privateKeyArmored });
      return await decryptKey({ privateKey, passphrase });
    } catch {
      throw new ValidationError("Signing key private key or passphrase is invalid");
    }
  }

  private toPublic(record: SigningKeyRecord): PublicSigningKey {
    return {
      id: record.id,
      repositoryName: record.repositoryName,
      name: record.name,
      publicKeyArmored: record.publicKeyArmored,
      fingerprint: record.fingerprint,
      keyId: record.keyId,
      createdAt: record.createdAt,
      revokedAt: record.revokedAt ?? null,
    };
  }
}
