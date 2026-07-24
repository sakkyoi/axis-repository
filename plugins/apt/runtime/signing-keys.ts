import { NotFoundError, ValidationError } from "@axis-repository/core";
import { decryptKey, generateKey, readPrivateKey } from "openpgp";
import type {
  RepositoryActivePrivateSigningKey,
  RepositoryActiveSecret,
  RepositoryPublicSigningKey,
  RepositorySecretCapability,
  RepositorySecretRecord,
  RepositorySigningKeyCapability,
} from "@axis-repository/runtime-cloudflare/plugin-runtime";

const APT_SIGNING_KEY_NAMESPACE = "apt.signing-key";

export class AptSigningKeyResource implements RepositorySigningKeyCapability {
  constructor(private readonly options: { secrets: RepositorySecretCapability }) {}

  async listForRepository(repositoryName: string): Promise<RepositoryPublicSigningKey[]> {
    return (await this.options.secrets.list({
      namespace: APT_SIGNING_KEY_NAMESPACE,
      repositoryName,
    })).map(toPublicSigningKey);
  }

  async create(input: {
    repositoryName: string;
    name: string;
    privateKeyArmored: string;
    passphrase: string;
  }): Promise<RepositoryPublicSigningKey> {
    const repositoryName = input.repositoryName.trim();
    if (!repositoryName) throw new ValidationError("Signing key repository name is required");
    const name = input.name.trim();
    if (!name) throw new ValidationError("Signing key name is required");
    const privateKey = await readAndDecryptPrivateKey(input.privateKeyArmored, input.passphrase);
    const publicKeyArmored = privateKey.toPublic().armor();
    const fingerprint = privateKey.getFingerprint().toUpperCase();
    const keyId = privateKey.getKeyID().toHex().toUpperCase();

    return toPublicSigningKey(await this.options.secrets.create({
      namespace: APT_SIGNING_KEY_NAMESPACE,
      repositoryName,
      name,
      publicMetadata: {
        publicKeyArmored,
        fingerprint,
        keyId,
      },
      secrets: {
        privateKeyArmored: input.privateKeyArmored,
        passphrase: input.passphrase,
      },
    }));
  }

  async generate(input: {
    repositoryName: string;
    name: string;
    userIdName: string;
    userIdEmail: string;
  }): Promise<RepositoryPublicSigningKey> {
    const userIdName = input.userIdName.trim();
    const userIdEmail = input.userIdEmail.trim();
    if (!userIdName) throw new ValidationError("Signing key user ID name is required");
    if (!userIdEmail) throw new ValidationError("Signing key user ID email is required");

    const passphrase = this.options.secrets.createSecretValue("pgp_passphrase");
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

  async getPublicKey(id: string): Promise<RepositoryPublicSigningKey> {
    return toPublicSigningKey(await this.options.secrets.get(id));
  }

  async getActivePrivateKey(id: string): Promise<RepositoryActivePrivateSigningKey> {
    const secret = await this.options.secrets.getActive(id);
    return toActivePrivateSigningKey(secret);
  }

  async revoke(id: string): Promise<RepositoryPublicSigningKey> {
    return toPublicSigningKey(await this.options.secrets.revoke(id));
  }
}

async function readAndDecryptPrivateKey(privateKeyArmored: string, passphrase: string) {
  try {
    const privateKey = await readPrivateKey({ armoredKey: privateKeyArmored });
    return await decryptKey({ privateKey, passphrase });
  } catch {
    throw new ValidationError("Signing key private key or passphrase is invalid");
  }
}

function toPublicSigningKey(record: RepositorySecretRecord): RepositoryPublicSigningKey {
  return {
    id: record.id,
    repositoryName: record.repositoryName,
    name: record.name,
    publicKeyArmored: requiredString(record.publicMetadata.publicKeyArmored),
    fingerprint: requiredString(record.publicMetadata.fingerprint),
    keyId: requiredString(record.publicMetadata.keyId),
    createdAt: record.createdAt,
    revokedAt: record.revokedAt,
  };
}

function toActivePrivateSigningKey(record: RepositoryActiveSecret): RepositoryActivePrivateSigningKey {
  if (record.revokedAt) {
    throw new ValidationError("Signing key has been revoked");
  }
  return {
    id: record.id,
    repositoryName: record.repositoryName,
    privateKeyArmored: requiredString(record.secrets.privateKeyArmored),
    passphrase: requiredString(record.secrets.passphrase),
    fingerprint: requiredString(record.publicMetadata.fingerprint),
    keyId: requiredString(record.publicMetadata.keyId),
  };
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || !value) {
    throw new NotFoundError();
  }
  return value;
}
