import type { AxiosInstance } from "axios";
import { createHttpClient, type HttpOptions } from "./http";
import {
  aptSourceInfoSchema,
  installInstructionsSchema,
  adminSessionSchema,
  pypiClientInfoSchema,
  publishTokenCreateResponseSchema,
  publishTokenSchema,
  publishTokensResponseSchema,
  repositoryPluginsResponseSchema,
  repositoriesResponseSchema,
  repositorySchema,
  signingKeySchema,
  signingKeysResponseSchema,
  type PublishTokenCreateResponse,
  type Repository,
  type RepositoryPlugin,
  type RepositoryVisibility,
  type SigningKey,
  type AptSourceInfo,
  type InstallInstructions,
  type PypiClientInfo,
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
  listRepositoryPlugins(): Promise<RepositoryPlugin[]>;
  listRepositories(): Promise<Repository[]>;
  createRepository(input: CreateRepositoryInput): Promise<Repository>;
  getRepository(name: string): Promise<Repository>;
  updateRepository(name: string, input: UpdateRepositoryInput): Promise<Repository>;
  getAptSigningPublicKey(name: string): Promise<string>;
  getAptSourceInfo(name: string): Promise<AptSourceInfo>;
  getAptInstallInstructions(name: string): Promise<InstallInstructions>;
  getPypiClientInfo(name: string): Promise<PypiClientInfo>;
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
    async listRepositoryPlugins() {
      const response = await http.get("/admin/repository-plugins");
      return repositoryPluginsResponseSchema.parse(response.data).plugins;
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
    async getAptSigningPublicKey(name: string) {
      const response = await http.get(`/admin/repositories/${encodePathSegment(name)}/apt/client/key.gpg`);
      return typeof response.data === "string" ? response.data : String(response.data);
    },
    async getAptSourceInfo(name: string) {
      const response = await http.get(`/admin/repositories/${encodePathSegment(name)}/apt/client/source`);
      return aptSourceInfoSchema.parse(response.data);
    },
    async getAptInstallInstructions(name: string) {
      const response = await http.get(`/admin/repositories/${encodePathSegment(name)}/apt/client/install`);
      return installInstructionsSchema.parse(response.data);
    },
    async getPypiClientInfo(name: string) {
      const response = await http.get(`/admin/repositories/${encodePathSegment(name)}/pypi/client/simple-url`);
      return pypiClientInfoSchema.parse(response.data);
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
