export type Ecosystem = "apt" | "pypi" | (string & {});

export type RepositoryVisibility = "private" | "public";

export interface Repository {
  id: string;
  name: string;
  ecosystem: Ecosystem;
  visibility: RepositoryVisibility;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface RepositoryPluginPolicyRecord {
  ecosystem: Ecosystem;
  enabledOverride: boolean | null;
}

export interface EncryptedSecret {
  algorithm: "AES-GCM";
  iv: string;
  ciphertext: string;
}

export interface SigningKeyRecord {
  id: string;
  repositoryName: string;
  name: string;
  publicKeyArmored: string;
  encryptedPrivateKeyArmored: EncryptedSecret;
  encryptedPassphrase: EncryptedSecret;
  fingerprint: string;
  keyId: string;
  createdAt: string;
  revokedAt?: string;
}

export interface RepositorySecretRecord {
  id: string;
  namespace: string;
  repositoryName: string;
  name: string;
  publicMetadata: Record<string, unknown>;
  encryptedSecrets: EncryptedSecret;
  createdAt: string;
  revokedAt?: string;
}

export interface TokenPrincipal {
  tokenId: string;
  name: string;
  permissions: string[];
  repositories: string[];
  ecosystemScopes: Record<string, unknown>;
  signingKeyIds: string[];
  owner?: PrincipalRef;
}

export interface AdminPrincipal {
  type: "admin";
  subject: string;
  username: string;
  role: "owner";
  scopes: string[];
  sessionId: string;
}

export interface PrincipalRef {
  type: "admin-user";
  subject: string;
  displayName: string;
}

export interface AdminUserRecord {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
  role: "owner";
  createdAt: string;
  updatedAt: string;
  disabledAt?: string;
}

export interface AdminRefreshSessionRecord {
  id: string;
  subject: string;
  username: string;
  role: "owner";
  tokenHash: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string;
  rotatedAt?: string;
  revokedAt?: string;
}

export interface PublishTokenRecord {
  id: string;
  name: string;
  tokenHash: string;
  permissions: string[];
  repositories: string[];
  ecosystemScopes: Record<string, unknown>;
  signingKeyIds: string[];
  owner?: PrincipalRef;
  createdAt: string;
  expiresAt?: string;
  rotatedAt?: string;
  revokedAt?: string;
}

export interface PublishArtifactRequest {
  filename: string;
  size: number;
  sha256: string;
  contentType: string;
  metadata: Record<string, unknown>;
}

export type PublishSessionStatus =
  | "pending_uploads"
  | "ready"
  | "finalizing"
  | "finalized"
  | "failed";

export interface PublishSession {
  id: string;
  repositoryName: string;
  ecosystem: Ecosystem;
  status: PublishSessionStatus;
  requestedBy: TokenPrincipal;
  artifacts: PublishArtifactRequest[];
  uploads: UploadTarget[];
  verifiedUploads: VerifiedUpload[];
  createdAt: string;
  expiresAt: string;
  publishStartedAt?: string;
  finalizingStartedAt?: string;
  finalizedAt?: string;
  failure?: PublishFailure;
  publishResult?: PublishResult;
}

export interface UploadTarget {
  uploadId: string;
  filename: string;
  objectKey: string;
  method: "PUT";
  url: string;
  headers: Record<string, string>;
  expiresAt: string;
}

export interface UploadedObject {
  uploadId: string;
  objectKey: string;
  size: number;
  sha256: string;
}

export interface VerifiedUpload extends UploadedObject {
  verifiedAt: string;
}

export interface PublishedObject {
  key: string;
  contentType: string;
  previous?: {
    contentType?: string;
    size?: number;
    etag?: string;
  };
}

export interface PublishResult {
  objects: PublishedObject[];
  publishedAt: string;
}

export interface RepositoryArtifactRecord {
  id: string;
  repositoryName: string;
  ecosystem: Ecosystem;
  identity: string;
  /**
   * What this artifact is a version of.
   *
   * Two records sharing it are the same thing at different versions, which is
   * a question only the ecosystem can answer: apt tells its architectures and
   * components apart and pypi does not, so a name alone is the right answer
   * for one and the wrong answer for the other. Absent where a plugin has not
   * said, and then each artifact stands alone.
   */
  family?: string;
  name: string;
  version?: string;
  summary: string;
  primaryObjectKey?: string;
  objectKeys: string[];
  metadata: Record<string, unknown>;
  publishedAt: string;
  updatedAt: string;
  publishSessionId?: string;
}

export interface PublishFailure {
  message: string;
  failedAt: string;
}

export interface PublishedArtifactInput {
  artifact: PublishArtifactRequest;
  upload: UploadTarget;
  verified: VerifiedUpload;
}

export interface PublishArtifactsInput {
  repository: Repository;
  session: PublishSession;
  artifacts: PublishedArtifactInput[];
}

export const REPOSITORY_ACTIVITY_TYPES = {
  objectDelete: "object.delete",
  objectUpdate: "object.update",
  artifactIndexRebuild: "artifact-index.rebuild",
  artifactDelete: "artifact.delete",
} as const;

export type RepositoryActivityType = typeof REPOSITORY_ACTIVITY_TYPES[keyof typeof REPOSITORY_ACTIVITY_TYPES];

export interface RepositoryActivityRecord {
  id: string;
  repositoryName: string;
  type: RepositoryActivityType;
  actor: "admin";
  summary: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}
