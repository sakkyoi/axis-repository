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

export interface TokenPrincipal {
  tokenId: string;
  name: string;
  permissions: string[];
  repositories: string[];
  ecosystemScopes: Record<string, unknown>;
}

export interface PublishTokenRecord {
  id: string;
  name: string;
  tokenHash: string;
  permissions: string[];
  repositories: string[];
  ecosystemScopes: Record<string, unknown>;
  createdAt: string;
  expiresAt?: string;
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
  | "failed"
  | "aborted"
  | "expired";

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
  finalizedAt?: string;
  failure?: string;
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
  artifact: PublishArtifactRequest;
  upload: VerifiedUpload;
  objectKey: string;
  size: number;
  sha256: string;
}

export interface PublishResult {
  repositoryName: string;
  ecosystem: Ecosystem;
  objects: PublishedObject[];
  publishedAt: string;
}

export interface PublishedArtifactInput {
  artifact: PublishArtifactRequest;
  upload: VerifiedUpload;
}

export interface PublishArtifactsInput {
  session: PublishSession;
  artifacts: PublishedArtifactInput[];
}
