import axios, { type AxiosInstance } from "axios";
import { createHttpClient, withSessionCookie, type HttpOptions } from "./http";
import {
  adminSessionSchema,
  adminAuthResponseSchema,
  adminUsersResponseSchema,
  publishSessionsResponseSchema,
  createdPublishSessionSchema,
  publishSessionSchema,
  publishTokenCreateResponseSchema,
  publishTokenSchema,
  publishTokensResponseSchema,
  repositoryPluginSchema,
  repositoryPluginsResponseSchema,
  repositoryActivitiesResponseSchema,
  repositoryArtifactDeleteResponseSchema,
  repositoryArtifactsResponseSchema,
  repositoryObjectDeleteResponseSchema,
  repositoryObjectDetailResponseSchema,
  repositoryObjectsResponseSchema,
  repositoriesResponseSchema,
  repositorySchema,
  type PublishTokenCreateResponse,
  type Repository,
  type RepositoryActivity,
  type RepositoryObjectDetail,
  type RepositoryPlugin,
  type RepositoryVisibility,
  type PublishSession,
  type PublishArtifact,
  type AdminAuthResponse,
  type AdminUser,
  type CreatedPublishSession,
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
  provisioning?: Record<string, unknown>;
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

export interface ListRepositoryActivitiesOptions {
  limit?: number;
  cursor?: string;
}

export interface AxisClient {
  http: AxiosInstance;
  loginAdmin(input: { username: string; password: string }): Promise<AdminAuthResponse>;
  refreshAdminSession(): Promise<AdminAuthResponse>;
  logoutAdmin(): Promise<void>;
  changeOwnPassword(input: { currentPassword: string; newPassword: string }): Promise<void>;
  getAdminSession(): Promise<ReturnType<typeof adminSessionSchema.parse>>;
  verifyAdminSession(): Promise<void>;
  listAdminUsers(): Promise<{ users: AdminUser[]; canCreateUsers: boolean }>;
  listRepositoryPlugins(): Promise<RepositoryPlugin[]>;
  updateRepositoryPluginPolicy(ecosystem: string, input: UpdateRepositoryPluginPolicyInput): Promise<RepositoryPlugin>;
  listRepositories(): Promise<Repository[]>;
  createRepository(input: CreateRepositoryInput): Promise<Repository>;
  getRepository(name: string): Promise<Repository>;
  updateRepository(name: string, input: UpdateRepositoryInput): Promise<Repository>;
  deleteRepository(name: string): Promise<void>;
  listRepositoryObjects(name: string, prefix: string): Promise<ReturnType<typeof repositoryObjectsResponseSchema.parse>>;
  listRepositoryArtifacts(name: string): Promise<ReturnType<typeof repositoryArtifactsResponseSchema.parse>>;
  rebuildRepositoryArtifactIndex(name: string): Promise<ReturnType<typeof repositoryArtifactsResponseSchema.parse>>;
  deleteRepositoryArtifact(name: string, artifactId: string): Promise<ReturnType<typeof repositoryArtifactDeleteResponseSchema.parse>>;
  getRepositoryObjectDetail(name: string, path: string): Promise<RepositoryObjectDetail>;
  deleteRepositoryObject(name: string, path: string): Promise<RepositoryActivity>;
  listRepositoryActivities(name: string, options?: ListRepositoryActivitiesOptions): Promise<ReturnType<typeof repositoryActivitiesResponseSchema.parse>>;
  getRepositoryClientHelper(name: string, namespace: string, action: string): Promise<unknown>;
  getRepositoryPluginResource(name: string, namespace: string, path: readonly string[]): Promise<unknown>;
  postRepositoryPluginResource(name: string, namespace: string, path: readonly string[], input?: unknown): Promise<unknown>;
  listPublishSessions(): Promise<PublishSession[]>;
  createAdminPublishSession(input: CreateAdminPublishSessionInput): Promise<CreatedPublishSession>;
  uploadPublishArtifact(target: UploadTarget, body: Blob): Promise<void>;
  verifyAdminPublishUpload(sessionId: string, uploadId: string): Promise<PublishSession>;
  finalizeAdminPublishSession(sessionId: string): Promise<PublishSession>;
  listPublishTokens(): Promise<ReturnType<typeof publishTokensResponseSchema.parse>["publishTokens"]>;
  getPublishToken(name: string): Promise<ReturnType<typeof publishTokenSchema.parse>>;
  createPublishToken(input: CreatePublishTokenInput): Promise<PublishTokenCreateResponse>;
  revokePublishToken(name: string): Promise<ReturnType<typeof publishTokenSchema.parse>>;
  rotatePublishToken(name: string): Promise<PublishTokenCreateResponse>;
  deletePublishToken(name: string): Promise<void>;
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

function repositoryPluginResourceUrl(name: string, namespace: string, path: readonly string[]): string {
  const encodedPath = path.map(encodePathSegment).join("/");
  const suffix = encodedPath ? `/${encodedPath}` : "";
  return `/admin/repositories/${encodePathSegment(name)}/${encodePathSegment(namespace)}${suffix}`;
}

function repositoryActivityUrl(name: string, options: ListRepositoryActivitiesOptions = {}): string {
  const searchParams = new URLSearchParams();
  if (options.limit !== undefined) {
    searchParams.set("limit", String(options.limit));
  }
  if (options.cursor !== undefined) {
    searchParams.set("cursor", options.cursor);
  }
  const query = searchParams.toString();
  return `/admin/repositories/${encodePathSegment(name)}/activity${query ? `?${query}` : ""}`;
}

export function createAxisClient(options: HttpOptions): AxisClient {
  const http = createHttpClient(options);
  return {
    http,
    async loginAdmin(input: { username: string; password: string }) {
      const response = await http.post("/admin/auth/login", input, withSessionCookie);
      return adminAuthResponseSchema.parse(response.data);
    },
    async refreshAdminSession() {
      const response = await http.post("/admin/auth/refresh", undefined, withSessionCookie);
      return adminAuthResponseSchema.parse(response.data);
    },
    async logoutAdmin() {
      await http.post("/admin/auth/logout", undefined, withSessionCookie);
    },
    async changeOwnPassword(input: { currentPassword: string; newPassword: string }) {
      await http.post("/admin/auth/change-password", input, withSessionCookie);
    },
    async getAdminSession() {
      const response = await http.get("/admin/session");
      return adminSessionSchema.parse(response.data);
    },
    async verifyAdminSession() {
      const response = await http.get("/admin/session");
      adminSessionSchema.parse(response.data);
    },
    async listAdminUsers() {
      const response = await http.get("/admin/users");
      return adminUsersResponseSchema.parse(response.data);
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
    async deleteRepository(name: string) {
      await http.delete(`/admin/repositories/${encodePathSegment(name)}`);
    },
    async listRepositoryObjects(name: string, prefix: string) {
      const response = await http.get(
        `/admin/repositories/${encodePathSegment(name)}/objects?prefix=${encodeURIComponent(prefix)}`,
      );
      return repositoryObjectsResponseSchema.parse(response.data);
    },
    async listRepositoryArtifacts(name: string) {
      const response = await http.get(`/admin/repositories/${encodePathSegment(name)}/artifacts`);
      return repositoryArtifactsResponseSchema.parse(response.data);
    },
    async rebuildRepositoryArtifactIndex(name: string) {
      const response = await http.post(`/admin/repositories/${encodePathSegment(name)}/artifacts/rebuild-index`);
      return repositoryArtifactsResponseSchema.parse(response.data);
    },
    async deleteRepositoryArtifact(name: string, artifactId: string) {
      const response = await http.delete(
        `/admin/repositories/${encodePathSegment(name)}/artifacts/${encodePathSegment(artifactId)}`,
      );
      return repositoryArtifactDeleteResponseSchema.parse(response.data);
    },
    async getRepositoryObjectDetail(name: string, path: string) {
      const response = await http.get(
        `/admin/repositories/${encodePathSegment(name)}/objects/detail?path=${encodeURIComponent(path)}`,
      );
      return repositoryObjectDetailResponseSchema.parse(response.data).object;
    },
    async deleteRepositoryObject(name: string, path: string) {
      const response = await http.delete(
        `/admin/repositories/${encodePathSegment(name)}/objects?path=${encodeURIComponent(path)}`,
      );
      return repositoryObjectDeleteResponseSchema.parse(response.data).activity;
    },
    async listRepositoryActivities(name: string, options: ListRepositoryActivitiesOptions = {}) {
      const response = await http.get(repositoryActivityUrl(name, options));
      return repositoryActivitiesResponseSchema.parse(response.data);
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
      return createdPublishSessionSchema.parse(response.data);
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
    async rotatePublishToken(name: string) {
      const response = await http.post(`/admin/publish-tokens/${encodePathSegment(name)}/rotate`);
      return publishTokenCreateResponseSchema.parse(response.data);
    },
    async deletePublishToken(name: string) {
      await http.delete(`/admin/publish-tokens/${encodePathSegment(name)}`);
    },
  };
}
