import type {
  PublishSession,
  PublishTokenRecord,
  AdminPrincipal,
  AdminRefreshSessionRecord,
  AdminUserRecord,
  RepositorySecretRecord,
  SigningKeyRecord,
  UploadedObject,
  UploadTarget,
  Repository,
  RepositoryArtifactRecord,
  RepositoryActivityRecord,
  PublishArtifactRequest,
  PublishArtifactsInput,
  PublishResult,
  RepositoryPluginPolicyRecord,
} from "../domain/domain";

export interface Clock {
  now(): Date;
}

export interface RandomId {
  create(prefix: string): string;
}

/**
 * Digests high-entropy machine secrets (publish tokens, refresh tokens). A fast
 * digest is appropriate here: the secrets are randomly generated, so there is
 * nothing to brute force, and verification scans stored records.
 */
export interface SecretHasher {
  hash(secret: string): Promise<string>;
  verify(secret: string, hash: string): Promise<boolean>;
}

/**
 * Digests human-chosen passwords. Distinct from {@link SecretHasher} because
 * passwords are low entropy and need a per-user salt and a deliberate work
 * factor; verification is a single lookup by username, so the cost is bounded.
 */
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, hash: string): Promise<boolean>;
  /** True when the stored hash uses outdated parameters and should be rewritten. */
  needsRehash(hash: string): boolean;
}

export interface UploadBroker {
  createUploadTarget(input: {
    /** Staging keys are partitioned by repository so they can be scoped. */
    repositoryName: string;
    sessionId: string;
    uploadId: string;
    artifact: PublishArtifactRequest;
    expiresAt: Date;
  }): Promise<UploadTarget>;

  verifyUpload(input: {
    target: UploadTarget;
    expected: PublishArtifactRequest;
  }): Promise<UploadedObject>;

}

export interface ArtifactPublisher {
  /**
   * Publishers must be idempotent for the same publish session so a
   * finalizing session can be retried after state-save failures.
   */
  publish(input: PublishArtifactsInput): Promise<PublishResult>;
}

export interface RepositoryObjectRange {
  offset: number;
  length: number;
}

export interface RepositoryObjectReadOptions {
  range?: RepositoryObjectRange;
}

export interface RepositoryObjectMetadata {
  contentType?: string;
  contentLength?: number;
  etag?: string;
}

export interface AdminAccessTokenCodec {
  create(principal: AdminPrincipal, expiresAt: Date): Promise<string>;
  verify(token: string): Promise<AdminPrincipal>;
}

export interface RepositoryObjectListDirectory {
  path: string;
}

export interface RepositoryObjectListItem extends RepositoryObjectMetadata {
  key: string;
}

export interface RepositoryObjectList {
  prefix: string;
  directories: RepositoryObjectListDirectory[];
  objects: RepositoryObjectListItem[];
  cursor?: string;
  truncated: boolean;
}

export interface RepositoryObject {
  body: string | Uint8Array | ReadableStream;
  contentType?: string;
  contentLength?: number;
  etag?: string;
  range?: RepositoryObjectRange;
}

export interface RepositoryObjectStore {
  putJson(key: string, value: unknown): Promise<void>;
  putText(key: string, value: string, contentType: string): Promise<void>;
  putBytes(key: string, value: Uint8Array, contentType: string): Promise<void>;
  copyObject(sourceKey: string, destinationKey: string, contentType?: string): Promise<void>;
  listObjects(input: { prefix: string; delimiter?: string; cursor?: string; limit?: number }): Promise<RepositoryObjectList>;
  headObject(key: string): Promise<RepositoryObjectMetadata | null>;
  getObject(key: string, options?: RepositoryObjectReadOptions): Promise<RepositoryObject | null>;
  deleteObject(key: string): Promise<boolean>;
}

export interface RepositoryStore {
  getByName(name: string): Promise<Repository | null>;
  list(): Promise<Repository[]>;
  save(repository: Repository): Promise<void>;
  deleteByName(name: string): Promise<boolean>;
}

export interface PublishSessionStore {
  get(id: string): Promise<PublishSession | null>;
  list(): Promise<PublishSession[]>;
  save(session: PublishSession): Promise<void>;
  deleteByRepository(repositoryName: string): Promise<number>;
  update(
    id: string,
    updater: (current: PublishSession) => PublishSession,
  ): Promise<PublishSession | null>;
}

export interface PublishTokenStore {
  getById(id: string): Promise<PublishTokenRecord | null>;
  getByName(name: string): Promise<PublishTokenRecord | null>;
  list(): Promise<PublishTokenRecord[]>;
  save(token: PublishTokenRecord): Promise<void>;
  deleteByName(name: string): Promise<boolean>;
}

export interface AdminRefreshSessionStore {
  get(id: string): Promise<AdminRefreshSessionRecord | null>;
  list(): Promise<AdminRefreshSessionRecord[]>;
  save(session: AdminRefreshSessionRecord): Promise<void>;
  /** Removes a session outright; revoked and expired records are not kept. */
  delete(id: string): Promise<boolean>;
}

export interface AdminUserStore {
  getById(id: string): Promise<AdminUserRecord | null>;
  getByUsername(username: string): Promise<AdminUserRecord | null>;
  list(): Promise<AdminUserRecord[]>;
  save(user: AdminUserRecord): Promise<void>;
}

export interface RepositorySecretStore {
  getById(id: string): Promise<RepositorySecretRecord | SigningKeyRecord | null>;
  getByName(name: string, repositoryName: string, namespace: string): Promise<RepositorySecretRecord | null>;
  list(): Promise<Array<RepositorySecretRecord | SigningKeyRecord>>;
  save(record: RepositorySecretRecord): Promise<void>;
  deleteByRepository(repositoryName: string): Promise<number>;
}

export interface RepositoryPluginPolicyStore {
  getByEcosystem(ecosystem: string): Promise<RepositoryPluginPolicyRecord | null>;
  list(): Promise<RepositoryPluginPolicyRecord[]>;
  save(record: RepositoryPluginPolicyRecord): Promise<void>;
}

export interface RepositoryActivityStore {
  listByRepository(repositoryName: string): Promise<RepositoryActivityRecord[]>;
  save(record: RepositoryActivityRecord): Promise<void>;
  deleteByRepository(repositoryName: string): Promise<number>;
}

export interface RepositoryArtifactStore {
  listByRepository(repositoryName: string): Promise<RepositoryArtifactRecord[]>;
  upsert(record: RepositoryArtifactRecord): Promise<void>;
  replaceByRepository(repositoryName: string, records: RepositoryArtifactRecord[]): Promise<void>;
}

export interface StateStore {
  repositories: RepositoryStore;
  publishSessions: PublishSessionStore;
  publishTokens: PublishTokenStore;
  adminUsers: AdminUserStore;
  adminRefreshSessions: AdminRefreshSessionStore;
  repositorySecrets: RepositorySecretStore;
  repositoryPluginPolicies: RepositoryPluginPolicyStore;
  repositoryActivities: RepositoryActivityStore;
  repositoryArtifacts: RepositoryArtifactStore;
}
