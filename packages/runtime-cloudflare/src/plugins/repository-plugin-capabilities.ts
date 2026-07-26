export interface RepositoryPublicSigningKey {
  id: string;
  repositoryName: string;
  name: string;
  publicKeyArmored: string;
  fingerprint: string;
  keyId: string;
  createdAt: string;
  revokedAt: string | null;
}

export interface RepositoryActivePrivateSigningKey {
  id: string;
  repositoryName: string;
  privateKeyArmored: string;
  passphrase: string;
  fingerprint: string;
  keyId: string;
}

export interface RepositorySigningKeyCapability {
  listForRepository(repositoryName: string): Promise<RepositoryPublicSigningKey[]>;
  create(input: {
    repositoryName: string;
    name: string;
    privateKeyArmored: string;
    passphrase: string;
  }): Promise<RepositoryPublicSigningKey>;
  generate(input: {
    repositoryName: string;
    name: string;
    userIdName: string;
    userIdEmail: string;
  }): Promise<RepositoryPublicSigningKey>;
  getPublicKey(id: string): Promise<RepositoryPublicSigningKey>;
  /**
   * Resolves a usable private key only when it belongs to `repositoryName`.
   * The repository is required so that callers cannot sign one repository's
   * metadata with another repository's key.
   */
  getActivePrivateKey(id: string, repositoryName: string): Promise<RepositoryActivePrivateSigningKey>;
  revoke(id: string): Promise<RepositoryPublicSigningKey>;
}

export interface RepositorySecretRecord {
  id: string;
  namespace: string;
  repositoryName: string;
  name: string;
  publicMetadata: Record<string, unknown>;
  createdAt: string;
  revokedAt: string | null;
}

export interface RepositoryActiveSecret extends RepositorySecretRecord {
  secrets: Record<string, string>;
}

export interface RepositorySecretCapability {
  createSecretValue(prefix: string): string;
  create(input: {
    namespace: string;
    repositoryName: string;
    name: string;
    publicMetadata: Record<string, unknown>;
    secrets: Record<string, string>;
  }): Promise<RepositorySecretRecord>;
  list(input: { namespace: string; repositoryName?: string }): Promise<RepositorySecretRecord[]>;
  get(id: string): Promise<RepositorySecretRecord>;
  getActive(id: string): Promise<RepositoryActiveSecret>;
  revoke(id: string): Promise<RepositorySecretRecord>;
}

export interface RepositoryRuntimePluginServices {
  secrets?: RepositorySecretCapability;
}
