import type {
  PublishSession,
  PublishTokenRecord,
  SigningKeyRecord,
  UploadedObject,
  UploadTarget,
  Repository,
  TokenPrincipal,
  PublishArtifactRequest,
  PublishArtifactsInput,
  PublishResult,
  RepositoryPluginPolicyRecord,
} from "./domain";

export interface Clock {
  now(): Date;
}

export interface RandomId {
  create(prefix: string): string;
}

export interface SecretHasher {
  hash(secret: string): Promise<string>;
  verify(secret: string, hash: string): Promise<boolean>;
}

export interface UploadBroker {
  createUploadTarget(input: {
    sessionId: string;
    uploadId: string;
    artifact: PublishArtifactRequest;
    expiresAt: Date;
  }): Promise<UploadTarget>;

  verifyUpload(input: {
    target: UploadTarget;
    expected: PublishArtifactRequest;
  }): Promise<UploadedObject>;

  abortUpload(input: { target: UploadTarget }): Promise<void>;
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
  headObject(key: string): Promise<RepositoryObjectMetadata | null>;
  getObject(key: string, options?: RepositoryObjectReadOptions): Promise<RepositoryObject | null>;
}

export interface RepositoryStore {
  getByName(name: string): Promise<Repository | null>;
  list(): Promise<Repository[]>;
  save(repository: Repository): Promise<void>;
}

export interface PublishSessionStore {
  get(id: string): Promise<PublishSession | null>;
  list(): Promise<PublishSession[]>;
  save(session: PublishSession): Promise<void>;
  update(
    id: string,
    updater: (current: PublishSession) => PublishSession,
  ): Promise<PublishSession | null>;
  compareAndSetStatus(
    id: string,
    expectedStatus: PublishSession["status"],
    session: PublishSession,
  ): Promise<boolean>;
}

export interface PublishTokenStore {
  getById(id: string): Promise<PublishTokenRecord | null>;
  getByName(name: string): Promise<PublishTokenRecord | null>;
  list(): Promise<PublishTokenRecord[]>;
  save(token: PublishTokenRecord): Promise<void>;
}

export interface SigningKeyStore {
  getById(id: string): Promise<SigningKeyRecord | null>;
  getByName(name: string, repositoryName: string): Promise<SigningKeyRecord | null>;
  list(): Promise<SigningKeyRecord[]>;
  save(record: SigningKeyRecord): Promise<void>;
}

export interface RepositoryPluginPolicyStore {
  getByEcosystem(ecosystem: string): Promise<RepositoryPluginPolicyRecord | null>;
  list(): Promise<RepositoryPluginPolicyRecord[]>;
  save(record: RepositoryPluginPolicyRecord): Promise<void>;
}

export interface TokenVerifier {
  verifyPublishToken(token: string): Promise<TokenPrincipal | null>;
}

export interface StateStore {
  repositories: RepositoryStore;
  publishSessions: PublishSessionStore;
  publishTokens: PublishTokenStore;
  signingKeys: SigningKeyStore;
  repositoryPluginPolicies: RepositoryPluginPolicyStore;
}
