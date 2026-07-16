import type {
  PublishSession,
  PublishTokenRecord,
  UploadedObject,
  UploadTarget,
  Repository,
  TokenPrincipal,
  PublishArtifactRequest,
  PublishArtifactsInput,
  PublishResult,
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

export interface RepositoryObjectStore {
  putJson(key: string, value: unknown): Promise<void>;
}

export interface RepositoryStore {
  getByName(name: string): Promise<Repository | null>;
  list(): Promise<Repository[]>;
  save(repository: Repository): Promise<void>;
}

export interface PublishSessionStore {
  get(id: string): Promise<PublishSession | null>;
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

export interface TokenVerifier {
  verifyPublishToken(token: string): Promise<TokenPrincipal | null>;
}

export interface StateStore {
  repositories: RepositoryStore;
  publishSessions: PublishSessionStore;
  publishTokens: PublishTokenStore;
}
