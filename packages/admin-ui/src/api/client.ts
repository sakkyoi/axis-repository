import type { AxiosInstance } from "axios";
import { createHttpClient, type HttpOptions } from "./http";
import {
  installInstructionsSchema,
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
} from "./schemas";

export interface CreatePublishTokenInput {
  name: string;
  repositories: string[];
  permissions: string[];
  ecosystemScopes: Record<string, unknown>;
  signingKeyIds?: string[];
  expiresAt?: string;
}

export interface CreateSigningKeyInput {
  name: string;
  privateKeyArmored: string;
  passphrase: string;
}

export interface UpdateRepositoryInput {
  visibility?: RepositoryVisibility;
  config?: Record<string, unknown>;
}

export interface AxisClient {
  http: AxiosInstance;
  listRepositories(): Promise<Repository[]>;
  getRepository(name: string): Promise<Repository>;
  updateRepository(name: string, input: UpdateRepositoryInput): Promise<Repository>;
  getAptInstallInstructions(name: string): Promise<unknown>;
  listPublishTokens(): Promise<ReturnType<typeof publishTokensResponseSchema.parse>["publishTokens"]>;
  getPublishToken(name: string): Promise<ReturnType<typeof publishTokenSchema.parse>>;
  createPublishToken(input: CreatePublishTokenInput): Promise<PublishTokenCreateResponse>;
  revokePublishToken(name: string): Promise<ReturnType<typeof publishTokenSchema.parse>>;
  listSigningKeys(): Promise<SigningKey[]>;
  getSigningKey(id: string): Promise<SigningKey>;
  createSigningKey(input: CreateSigningKeyInput): Promise<SigningKey>;
  revokeSigningKey(id: string): Promise<SigningKey>;
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

export function createAxisClient(options: HttpOptions): AxisClient {
  const http = createHttpClient(options);
  return {
    http,
    async listRepositories() {
      const response = await http.get("/admin/repositories");
      return repositoriesResponseSchema.parse(response.data).repositories;
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
    async listSigningKeys() {
      const response = await http.get("/admin/signing-keys");
      return signingKeysResponseSchema.parse(response.data).signingKeys;
    },
    async getSigningKey(id: string) {
      const response = await http.get(`/admin/signing-keys/${encodePathSegment(id)}`);
      return signingKeySchema.parse(response.data);
    },
    async createSigningKey(input: CreateSigningKeyInput) {
      const response = await http.post("/admin/signing-keys", input);
      return signingKeySchema.parse(response.data);
    },
    async revokeSigningKey(id: string) {
      const response = await http.post(`/admin/signing-keys/${encodePathSegment(id)}/revoke`);
      return signingKeySchema.parse(response.data);
    },
  };
}
