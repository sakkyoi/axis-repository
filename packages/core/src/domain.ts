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

export interface PublishSession {
  id: string;
  repositoryName: string;
  ecosystem: Ecosystem;
  status: "created" | "completed" | "aborted" | "expired";
  requestedBy: TokenPrincipal;
  uploads: UploadTarget[];
  createdAt: string;
  expiresAt: string;
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
