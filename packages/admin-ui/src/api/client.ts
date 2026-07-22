import type { AxiosInstance } from "axios";
import { createHttpClient, type HttpOptions } from "./http";
import {
  installInstructionsSchema,
  adminSessionSchema,
  publishTokenCreateResponseSchema,
  publishTokenSchema,
  publishTokensResponseSchema,
  repositoriesResponseSchema,
  repositorySchema,
  signingKeySchema,
  signingKeysResponseSchema,
  type PublishTokenCreateResponse,
  type Repository,
  type RepositoryVisibility,
  type SigningKey,
  type InstallInstructions,
} from "./schemas";

export interface CreatePublishTokenInput {
  name: string;
  repositories: string[];
  permissions: string[];
  ecosystemScopes: Record<string, unknown>;
  signingKeyIds?: string[];
  expiresAt?: string;
}

export interface ImportAptSigningKeyInput {
  name: string;
  privateKeyArmored: string;
  passphrase: string;
}

export interface GenerateAptSigningKeyInput {
  name: string;
  userIdName: string;
  userIdEmail: string;
}

export interface CreateRepositoryInput {
  name: string;
  ecosystem: string;
  visibility: RepositoryVisibility;
  config: Record<string, unknown>;
}

export interface UpdateRepositoryInput {
  visibility?: RepositoryVisibility;
  config?: Record<string, unknown>;
}

export interface AxisClient {
  http: AxiosInstance;
  verifyAdminToken(): Promise<void>;
  listRepositories(): Promise<Repository[]>;
  createRepository(input: CreateRepositoryInput): Promise<Repository>;
  getRepository(name: string): Promise<Repository>;
  updateRepository(name: string, input: UpdateRepositoryInput): Promise<Repository>;
  getAptInstallInstructions(name: string): Promise<InstallInstructions>;
  listPublishTokens(): Promise<ReturnType<typeof publishTokensResponseSchema.parse>["publishTokens"]>;
  getPublishToken(name: string): Promise<ReturnType<typeof publishTokenSchema.parse>>;
  createPublishToken(input: CreatePublishTokenInput): Promise<PublishTokenCreateResponse>;
  revokePublishToken(name: string): Promise<ReturnType<typeof publishTokenSchema.parse>>;
  listAptSigningKeys(repositoryName: string): Promise<SigningKey[]>;
  getAptSigningKey(repositoryName: string, id: string): Promise<SigningKey>;
  importAptSigningKey(repositoryName: string, input: ImportAptSigningKeyInput): Promise<SigningKey>;
  generateAptSigningKey(repositoryName: string, input: GenerateAptSigningKeyInput): Promise<SigningKey>;
  revokeAptSigningKey(repositoryName: string, id: string): Promise<SigningKey>;
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

export function createAxisClient(options: HttpOptions): AxisClient {
  const http = createHttpClient(options);
  return {
    http,
    async verifyAdminToken() {
      const response = await http.get("/admin/session");
      adminSessionSchema.parse(response.data);
    },
    async listRepositories() {
      const response = await http.get("/admin/repositories");
      return repositoriesResponseSchema.parse(response.data).repositories;
    },
    async createRepository(input: CreateRepositoryInput) {
      const response = await http.post("/admin/repositories", input);
      return repositorySchema.parse(response.data);
    },
    async getRepository(name: string) {
      const response = await http.get(`/admin/repositories/${encodePathSegment(name)}`);
      return repositorySchema.parse(response.data);
    },
    async updateRepository(name: string, input: UpdateRepositoryInput) {
      const response = await http.patch(`/admin/repositories/${encodePathSegment(name)}`, input);
      return repositorySchema.parse(response.data);
    },
    async getAptInstallInstructions(name: string) {
      const response = await http.get(`/repositories/${encodePathSegment(name)}/apt/install`);
      return installInstructionsSchema.parse(response.data);
    },
    async listPublishTokens() {
      const response = await http.get("/admin/publish-tokens");
      return publishTokensResponseSchema.parse(response.data).publishTokens;
    },
    async getPublishToken(name: string) {
      const response = await http.get(`/admin/publish-tokens/${encodePathSegment(name)}`);
      return publishTokenSchema.parse(response.data);
    },
    async createPublishToken(input: CreatePublishTokenInput) {
      const response = await http.post("/admin/publish-tokens", input);
      return publishTokenCreateResponseSchema.parse(response.data);
    },
    async revokePublishToken(name: string) {
      const response = await http.post(`/admin/publish-tokens/${encodePathSegment(name)}/revoke`);
      return publishTokenSchema.parse(response.data);
    },
    async listAptSigningKeys(repositoryName: string) {
      const response = await http.get(`/admin/repositories/${encodePathSegment(repositoryName)}/apt/signing-keys`);
      return signingKeysResponseSchema.parse(response.data).signingKeys;
    },
    async getAptSigningKey(repositoryName: string, id: string) {
      const response = await http.get(`/admin/repositories/${encodePathSegment(repositoryName)}/apt/signing-keys/${encodePathSegment(id)}`);
      return signingKeySchema.parse(response.data);
    },
    async importAptSigningKey(repositoryName: string, input: ImportAptSigningKeyInput) {
      const response = await http.post(`/admin/repositories/${encodePathSegment(repositoryName)}/apt/signing-keys/import`, input);
      return signingKeySchema.parse(response.data);
    },
    async generateAptSigningKey(repositoryName: string, input: GenerateAptSigningKeyInput) {
      const response = await http.post(`/admin/repositories/${encodePathSegment(repositoryName)}/apt/signing-keys/generate`, input);
      return signingKeySchema.parse(response.data);
    },
    async revokeAptSigningKey(repositoryName: string, id: string) {
      const response = await http.post(`/admin/repositories/${encodePathSegment(repositoryName)}/apt/signing-keys/${encodePathSegment(id)}/revoke`);
      return signingKeySchema.parse(response.data);
    },
  };
}
