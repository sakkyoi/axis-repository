import type {
  PublishSession,
  UploadedObject,
  UploadTarget,
  Repository,
  TokenPrincipal,
  PublishArtifactRequest,
} from "./domain";

export interface Clock {
  now(): Date;
}

export interface RandomId {
  create(prefix: string): string;
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

export interface RepositoryStore {
  getByName(name: string): Promise<Repository | null>;
  save(repository: Repository): Promise<void>;
}

export interface PublishSessionStore {
  get(id: string): Promise<PublishSession | null>;
  save(session: PublishSession): Promise<void>;
}

export interface TokenVerifier {
  verifyPublishToken(token: string): Promise<TokenPrincipal | null>;
}

export interface StateStore {
  repositories: RepositoryStore;
  publishSessions: PublishSessionStore;
}
