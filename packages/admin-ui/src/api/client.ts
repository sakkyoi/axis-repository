import axios, { type AxiosInstance } from "axios";
import { createHttpClient, type HttpOptions } from "./http";
import {
  adminSessionSchema,
  publishSessionsResponseSchema,
  publishSessionSchema,
  publishTokenCreateResponseSchema,
  publishTokenSchema,
  publishTokensResponseSchema,
  repositoryPluginSchema,
  repositoryPluginsResponseSchema,
  repositoryObjectsResponseSchema,
  repositoriesResponseSchema,
  repositorySchema,
  type PublishTokenCreateResponse,
  type Repository,
  type RepositoryPlugin,
  type RepositoryVisibility,
  type PublishSession,
  type PublishArtifact,
  type UploadTarget,
} from "./schemas";

export interface CreatePublishTokenInput {
  name: string;
  repositories: string[];
  permissions: string[];
  ecosystemScopes: Record<string, unknown>;
  signingKeyIds?: string[];
  expiresAt?: string;
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

export interface UpdateRepositoryPluginPolicyInput {
  enabled: boolean | null;
}

export interface CreateAdminPublishSessionInput {
  repositoryName: string;
  ecosystem: string;
  artifacts: PublishArtifact[];
}

export interface AxisClient {
  http: AxiosInstance;
  verifyAdminToken(): Promise<void>;
  listRepositoryPlugins(): Promise<RepositoryPlugin[]>;
  updateRepositoryPluginPolicy(ecosystem: string, input: UpdateRepositoryPluginPolicyInput): Promise<RepositoryPlugin>;
  listRepositories(): Promise<Repository[]>;
  createRepository(input: CreateRepositoryInput): Promise<Repository>;
  getRepository(name: string): Promise<Repository>;
  updateRepository(name: string, input: UpdateRepositoryInput): Promise<Repository>;
  listRepositoryObjects(name: string, prefix: string): Promise<ReturnType<typeof repositoryObjectsResponseSchema.parse>>;
  getRepositoryClientHelper(name: string, namespace: string, action: string): Promise<unknown>;
  getRepositoryPluginResource(name: string, namespace: string, path: readonly string[]): Promise<unknown>;
  postRepositoryPluginResource(name: string, namespace: string, path: readonly string[], input?: unknown): Promise<unknown>;
  listPublishSessions(): Promise<PublishSession[]>;
  createAdminPublishSession(input: CreateAdminPublishSessionInput): Promise<PublishSession>;
  uploadPublishArtifact(target: UploadTarget, body: Blob): Promise<void>;
  verifyAdminPublishUpload(sessionId: string, uploadId: string): Promise<PublishSession>;
  finalizeAdminPublishSession(sessionId: string): Promise<PublishSession>;
  listPublishTokens(): Promise<ReturnType<typeof publishTokensResponseSchema.parse>["publishTokens"]>;
  getPublishToken(name: string): Promise<ReturnType<typeof publishTokenSchema.parse>>;
  createPublishToken(input: CreatePublishTokenInput): Promise<PublishTokenCreateResponse>;
  revokePublishToken(name: string): Promise<ReturnType<typeof publishTokenSchema.parse>>;
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

function repositoryPluginResourceUrl(name: string, namespace: string, path: readonly string[]): string {
  const encodedPath = path.map(encodePathSegment).join("/");
  const suffix = encodedPath ? `/${encodedPath}` : "";
  return `/admin/repositories/${encodePathSegment(name)}/${encodePathSegment(namespace)}${suffix}`;
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
    async updateRepositoryPluginPolicy(ecosystem: string, input: UpdateRepositoryPluginPolicyInput) {
      const response = await http.patch(`/admin/repository-plugins/${encodePathSegment(ecosystem)}`, input);
      return repositoryPluginSchema.parse(response.data);
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
    async listRepositoryObjects(name: string, prefix: string) {
      const response = await http.get(
        `/admin/repositories/${encodePathSegment(name)}/objects?prefix=${encodeURIComponent(prefix)}`,
      );
      return repositoryObjectsResponseSchema.parse(response.data);
    },
    async getRepositoryClientHelper(name: string, namespace: string, action: string) {
      const response = await http.get(
        `/admin/repositories/${encodePathSegment(name)}/${encodePathSegment(namespace)}/client/${encodePathSegment(action)}`,
      );
      return response.data;
    },
    async getRepositoryPluginResource(name: string, namespace: string, path: readonly string[]) {
      const response = await http.get(repositoryPluginResourceUrl(name, namespace, path));
      return response.data;
    },
    async postRepositoryPluginResource(name: string, namespace: string, path: readonly string[], input?: unknown) {
      const response = await http.post(repositoryPluginResourceUrl(name, namespace, path), input);
      return response.data;
    },
    async listPublishSessions() {
      const response = await http.get("/admin/publish-sessions");
      return publishSessionsResponseSchema.parse(response.data).sessions;
    },
    async createAdminPublishSession(input: CreateAdminPublishSessionInput) {
      const response = await http.post("/admin/publish-sessions", input);
      return publishSessionSchema.parse(response.data);
    },
    async uploadPublishArtifact(target: UploadTarget, body: Blob) {
      await axios.request({
        method: target.method,
        url: target.url,
        data: body,
        headers: target.headers,
        ...(http.defaults.adapter ? { adapter: http.defaults.adapter } : {}),
      });
    },
    async verifyAdminPublishUpload(sessionId: string, uploadId: string) {
      const response = await http.post(
        `/admin/publish-sessions/${encodePathSegment(sessionId)}/uploads/${encodePathSegment(uploadId)}/verify`,
      );
      return publishSessionSchema.parse(response.data.session);
    },
    async finalizeAdminPublishSession(sessionId: string) {
      const response = await http.post(`/admin/publish-sessions/${encodePathSegment(sessionId)}/finalize`);
      return publishSessionSchema.parse(response.data.session);
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
  };
}
