import axios, { type AxiosInstance } from "axios";
import { bulkRequest, createHttpClient, withSessionCookie, type HttpOptions } from "./http";
import {
  adminSessionSchema,
  adminAuthResponseSchema,
  adminUsersResponseSchema,
  publishSessionsResponseSchema,
  publishFinalizeResponseSchema,
  createdPublishSessionSchema,
  publishSessionSchema,
  deploymentResponseSchema,
  runtimeSettingsResponseSchema,
  publishTokenCreateResponseSchema,
  publishTokenSchema,
  publishTokensResponseSchema,
  repositoryPluginSchema,
  repositoryPluginsResponseSchema,
  repositoryActivitiesResponseSchema,
  repositoryDeleteResponseSchema,
  repositoryArtifactDeleteResponseSchema,
  repositoryArtifactFamiliesResponseSchema,
  repositoryArtifactsResponseSchema,
  backgroundJobResponseSchema,
  backgroundJobsResponseSchema,
  repositoryIndexJobResponseSchema,
  repositoryObjectDeleteResponseSchema,
  repositoryObjectDetailResponseSchema,
  repositoryObjectsResponseSchema,
  repositoriesResponseSchema,
  repositorySchema,
  type PublishTokenCreateResponse,
  type Repository,
  type RepositoryKind,
  type RepositoryActivity,
  type RepositoryObjectDetail,
  type RepositoryPlugin,
  type RepositoryVisibility,
  type PublishSession,
  type PublishFinalizeResponse,
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
  kind?: RepositoryKind;
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

export type RuntimeSettingsOverrides = ReturnType<typeof runtimeSettingsResponseSchema.parse>["overrides"];

export interface CreateAdminPublishSessionInput {
  repositoryName: string;
  ecosystem: string;
  artifacts: PublishArtifact[];
}

export interface ListRepositoryActivitiesOptions {
  limit?: number;
  cursor?: string;
}

export interface PageOptions {
  limit?: number;
  cursor?: string;
  family?: string;
}

export interface ListBackgroundJobsOptions {
  repositoryName?: string;
  status?: string;
  type?: string;
  limit?: number;
  offset?: number;
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
  getDeployment(): Promise<ReturnType<typeof deploymentResponseSchema.parse>>;
  getRuntimeSettings(): Promise<ReturnType<typeof runtimeSettingsResponseSchema.parse>>;
  updateRuntimeSettings(input: RuntimeSettingsOverrides): Promise<ReturnType<typeof runtimeSettingsResponseSchema.parse>>;
  listBackgroundJobs(options?: ListBackgroundJobsOptions): Promise<ReturnType<typeof backgroundJobsResponseSchema.parse>>;
  getBackgroundJob(id: string): Promise<ReturnType<typeof backgroundJobResponseSchema.parse>["job"]>;
  cancelBackgroundJob(id: string): Promise<ReturnType<typeof backgroundJobResponseSchema.parse>["job"]>;
  retryBackgroundJob(id: string): Promise<ReturnType<typeof backgroundJobResponseSchema.parse>["job"]>;
  listRepositoryPlugins(): Promise<RepositoryPlugin[]>;
  updateRepositoryPluginPolicy(ecosystem: string, input: UpdateRepositoryPluginPolicyInput): Promise<RepositoryPlugin>;
  listRepositories(): Promise<Repository[]>;
  createRepository(input: CreateRepositoryInput): Promise<Repository>;
  getRepository(name: string): Promise<Repository>;
  updateRepository(name: string, input: UpdateRepositoryInput): Promise<Repository>;
  deleteRepository(name: string): Promise<ReturnType<typeof repositoryDeleteResponseSchema.parse>>;
  listRepositoryObjects(name: string, prefix: string): Promise<ReturnType<typeof repositoryObjectsResponseSchema.parse>>;
  listRepositoryArtifactFamilies(
    name: string,
    options?: PageOptions,
  ): Promise<ReturnType<typeof repositoryArtifactFamiliesResponseSchema.parse>>;
  listRepositoryArtifacts(name: string, options?: PageOptions): Promise<ReturnType<typeof repositoryArtifactsResponseSchema.parse>>;
  rebuildRepositoryArtifactIndex(name: string): Promise<ReturnType<typeof repositoryIndexJobResponseSchema.parse>>;
  deleteRepositoryArtifact(name: string, artifactId: string): Promise<ReturnType<typeof repositoryArtifactDeleteResponseSchema.parse>>;
  getRepositoryObjectDetail(name: string, path: string): Promise<RepositoryObjectDetail>;
  deleteRepositoryObject(name: string, path: string): Promise<RepositoryActivity>;
  listRepositoryActivities(name: string, options?: ListRepositoryActivitiesOptions): Promise<ReturnType<typeof repositoryActivitiesResponseSchema.parse>>;
  getRepositoryClientHelper(name: string, namespace: string, action: string): Promise<unknown>;
  getRepositoryPluginResource(
    name: string,
    namespace: string,
    path: readonly string[],
    options?: { searchParams?: Record<string, string | number | undefined> },
  ): Promise<unknown>;
  postRepositoryPluginResource(name: string, namespace: string, path: readonly string[], input?: unknown): Promise<unknown>;
  listPublishSessions(): Promise<PublishSession[]>;
  getAdminPublishSession(sessionId: string): Promise<PublishSession>;
  createAdminPublishSession(input: CreateAdminPublishSessionInput): Promise<CreatedPublishSession>;
  uploadPublishArtifact(
    target: UploadTarget,
    body: Blob,
    onProgress?: (sent: { loaded: number; total?: number }) => void,
  ): Promise<void>;
  verifyAdminPublishUpload(sessionId: string, uploadId: string): Promise<PublishSession>;
  finalizeAdminPublishSession(sessionId: string): Promise<PublishFinalizeResponse>;
  listPublishTokens(): Promise<ReturnType<typeof publishTokensResponseSchema.parse>["publishTokens"]>;
  getPublishToken(name: string): Promise<ReturnType<typeof publishTokenSchema.parse>>;
  createPublishToken(input: CreatePublishTokenInput): Promise<PublishTokenCreateResponse>;
  revokePublishToken(name: string): Promise<ReturnType<typeof publishTokenSchema.parse>>;
  rotatePublishToken(name: string): Promise<PublishTokenCreateResponse>;
  deletePublishToken(name: string): Promise<void>;
}

function repositoryPluginResourceUrl(
  name: string,
  namespace: string,
  path: readonly string[],
  options: { searchParams?: Record<string, string | number | undefined> } = {},
): string {
  const encodedPath = path.map((segment) => encodeURIComponent(segment)).join("/");
  const suffix = encodedPath ? `/${encodedPath}` : "";
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(options.searchParams ?? {})) {
    if (value !== undefined) {
      searchParams.set(key, String(value));
    }
  }
  const query = searchParams.toString();
  return `/admin/repositories/${encodeURIComponent(name)}/${encodeURIComponent(namespace)}${suffix}${query ? `?${query}` : ""}`;
}

function pageUrl(path: string, options: PageOptions = {}): string {
  const searchParams = new URLSearchParams();
  if (options.limit !== undefined) {
    searchParams.set("limit", String(options.limit));
  }
  if (options.cursor !== undefined) {
    searchParams.set("cursor", options.cursor);
  }
  if (options.family !== undefined) {
    searchParams.set("family", options.family);
  }
  const query = searchParams.toString();
  return `${path}${query ? `?${query}` : ""}`;
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
  return `/admin/repositories/${encodeURIComponent(name)}/activity${query ? `?${query}` : ""}`;
}

function backgroundJobsUrl(options: ListBackgroundJobsOptions = {}): string {
  const searchParams = new URLSearchParams();
  if (options.repositoryName !== undefined) searchParams.set("repositoryName", options.repositoryName);
  if (options.status !== undefined) searchParams.set("status", options.status);
  if (options.type !== undefined) searchParams.set("type", options.type);
  if (options.limit !== undefined) searchParams.set("limit", String(options.limit));
  if (options.offset !== undefined) searchParams.set("offset", String(options.offset));
  const query = searchParams.toString();
  return `/admin/jobs${query ? `?${query}` : ""}`;
}

/**
 * Says what a refused upload was refused for, when the deployment cannot.
 *
 * An upload the worker relays can meet the deployment platform's request body
 * limit before it reaches the application, so nothing on the server side is in
 * a position to describe it. What gets back here is a bare 413, which as an
 * error message names neither the cause nor anything to do about it -- and the
 * person who picked the file is the one who can act on both.
 *
 * Returns undefined for anything else, which the caller rethrows untouched.
 */
function uploadTooLargeError(caught: unknown, size: number): Error | undefined {
  if (!axios.isAxiosError(caught) || caught.response?.status !== 413) {
    return undefined;
  }
  return new Error(
    `The upload was refused as too large (${(size / 1024 / 1024).toFixed(0)} MB).`
    + " This deployment sends uploads through the application worker, where the"
    + " platform can cap request bodies before one arrives. Publishing a smaller"
    + " file works, and so does using a deployment mode with direct object-storage"
    + " uploads, which avoids the worker request-body path.",
  );
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
      await http.post("/admin/auth/change-password", input);
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
    async getDeployment() {
      const response = await http.get("/admin/deployment");
      return deploymentResponseSchema.parse(response.data);
    },
    async getRuntimeSettings() {
      const response = await http.get("/admin/settings/runtime");
      return runtimeSettingsResponseSchema.parse(response.data);
    },
    async updateRuntimeSettings(input: RuntimeSettingsOverrides) {
      const response = await http.patch("/admin/settings/runtime", input);
      return runtimeSettingsResponseSchema.parse(response.data);
    },
    async listBackgroundJobs(options: ListBackgroundJobsOptions = {}) {
      const response = await http.get(backgroundJobsUrl(options));
      return backgroundJobsResponseSchema.parse(response.data);
    },
    async getBackgroundJob(id: string) {
      const response = await http.get(`/admin/jobs/${encodeURIComponent(id)}`);
      return backgroundJobResponseSchema.parse(response.data).job;
    },
    async cancelBackgroundJob(id: string) {
      const response = await http.post(`/admin/jobs/${encodeURIComponent(id)}/cancel`);
      return backgroundJobResponseSchema.parse(response.data).job;
    },
    async retryBackgroundJob(id: string) {
      const response = await http.post(`/admin/jobs/${encodeURIComponent(id)}/retry`);
      return backgroundJobResponseSchema.parse(response.data).job;
    },
    async listRepositoryPlugins() {
      const response = await http.get("/admin/repository-plugins");
      return repositoryPluginsResponseSchema.parse(response.data).plugins;
    },
    async updateRepositoryPluginPolicy(ecosystem: string, input: UpdateRepositoryPluginPolicyInput) {
      const response = await http.patch(`/admin/repository-plugins/${encodeURIComponent(ecosystem)}`, input);
      return repositoryPluginSchema.parse(response.data);
    },
    async createRepository(input: CreateRepositoryInput) {
      const response = await http.post("/admin/repositories", input);
      return repositorySchema.parse(response.data);
    },
    async getRepository(name: string) {
      const response = await http.get(`/admin/repositories/${encodeURIComponent(name)}`);
      return repositorySchema.parse(response.data);
    },
    async updateRepository(name: string, input: UpdateRepositoryInput) {
      const response = await http.patch(`/admin/repositories/${encodeURIComponent(name)}`, input);
      return repositorySchema.parse(response.data);
    },
    async deleteRepository(name: string) {
      const response = await http.delete(`/admin/repositories/${encodeURIComponent(name)}`);
      return repositoryDeleteResponseSchema.parse(response.data);
    },
    async listRepositoryObjects(name: string, prefix: string) {
      const response = await http.get(
        `/admin/repositories/${encodeURIComponent(name)}/objects?prefix=${encodeURIComponent(prefix)}`,
      );
      return repositoryObjectsResponseSchema.parse(response.data);
    },
    async listRepositoryArtifactFamilies(name: string, options: PageOptions = {}) {
      const response = await http.get(
        pageUrl(`/admin/repositories/${encodeURIComponent(name)}/artifacts/families`, options),
      );
      return repositoryArtifactFamiliesResponseSchema.parse(response.data);
    },
    async listRepositoryArtifacts(name: string, options: PageOptions = {}) {
      const response = await http.get(pageUrl(`/admin/repositories/${encodeURIComponent(name)}/artifacts`, options));
      return repositoryArtifactsResponseSchema.parse(response.data);
    },
    async rebuildRepositoryArtifactIndex(name: string) {
      const response = await http.post(
        `/admin/repositories/${encodeURIComponent(name)}/artifacts/rebuild-index`,
        undefined,
      );
      return repositoryIndexJobResponseSchema.parse(response.data);
    },
    async deleteRepositoryArtifact(name: string, artifactId: string) {
      const response = await http.delete(
        `/admin/repositories/${encodeURIComponent(name)}/artifacts/${encodeURIComponent(artifactId)}`,
      );
      return repositoryArtifactDeleteResponseSchema.parse(response.data);
    },
    async getRepositoryObjectDetail(name: string, path: string) {
      const response = await http.get(
        `/admin/repositories/${encodeURIComponent(name)}/objects/detail?path=${encodeURIComponent(path)}`,
      );
      return repositoryObjectDetailResponseSchema.parse(response.data).object;
    },
    async deleteRepositoryObject(name: string, path: string) {
      const response = await http.delete(
        `/admin/repositories/${encodeURIComponent(name)}/objects?path=${encodeURIComponent(path)}`,
      );
      return repositoryObjectDeleteResponseSchema.parse(response.data).activity;
    },
    async listRepositoryActivities(name: string, options: ListRepositoryActivitiesOptions = {}) {
      const response = await http.get(repositoryActivityUrl(name, options));
      return repositoryActivitiesResponseSchema.parse(response.data);
    },
    async getRepositoryClientHelper(name: string, namespace: string, action: string): Promise<unknown> {
      const response = await http.get<unknown>(
        `/admin/repositories/${encodeURIComponent(name)}/${encodeURIComponent(namespace)}/client/${encodeURIComponent(action)}`,
      );
      return response.data;
    },
    async getRepositoryPluginResource(
      name: string,
      namespace: string,
      path: readonly string[],
      options: { searchParams?: Record<string, string | number | undefined> } = {},
    ): Promise<unknown> {
      const response = await http.get<unknown>(repositoryPluginResourceUrl(name, namespace, path, options));
      return response.data;
    },
    async postRepositoryPluginResource(
      name: string,
      namespace: string,
      path: readonly string[],
      input?: unknown,
    ): Promise<unknown> {
      const response = await http.post<unknown>(repositoryPluginResourceUrl(name, namespace, path), input);
      return response.data;
    },
    async listPublishSessions() {
      const response = await http.get("/admin/publish-sessions");
      return publishSessionsResponseSchema.parse(response.data).sessions;
    },
    async getAdminPublishSession(sessionId: string) {
      const response = await http.get(`/admin/publish-sessions/${encodeURIComponent(sessionId)}`);
      return publishSessionSchema.parse(response.data.session);
    },
    async createAdminPublishSession(input: CreateAdminPublishSessionInput) {
      const response = await http.post("/admin/publish-sessions", input);
      return createdPublishSessionSchema.parse(response.data);
    },
    async uploadPublishArtifact(
      target: UploadTarget,
      body: Blob,
      onProgress?: (sent: { loaded: number; total?: number }) => void,
    ) {
      // Deliberately not `http`: the target is a presigned URL to R2, which
      // wants neither this client's base URL nor its Authorization header. It
      // gets no timeout either, and should not -- how long a PUT takes is the
      // artifact's size over the uploader's link, and no fixed number is right
      // for both a small package on an office connection and a large one on a
      // slow link.
      try {
        await axios.request({
          method: target.method,
          url: target.url,
          data: body,
          headers: target.headers,
          // The one request here that is worth watching go by: it is the
          // artifact itself, over the uploader's own link, and the only part
          // of a publish whose length anyone can feel.
          ...(onProgress ? { onUploadProgress: (event) => onProgress({ loaded: event.loaded, ...(event.total === undefined ? {} : { total: event.total }) }) } : {}),
          ...(http.defaults.adapter ? { adapter: http.defaults.adapter } : {}),
        });
      } catch (caught) {
        throw uploadTooLargeError(caught, body.size) ?? caught;
      }
    },
    async verifyAdminPublishUpload(sessionId: string, uploadId: string) {
      const response = await http.post<{ session: unknown }>(
        `/admin/publish-sessions/${encodeURIComponent(sessionId)}/uploads/${encodeURIComponent(uploadId)}/verify`,
        undefined,
        bulkRequest,
      );
      return publishSessionSchema.parse(response.data.session);
    },
    async finalizeAdminPublishSession(sessionId: string) {
      const response = await http.post(
        `/admin/publish-sessions/${encodeURIComponent(sessionId)}/finalize`,
        undefined,
      );
      return publishFinalizeResponseSchema.parse(response.data);
    },
    async listPublishTokens() {
      const response = await http.get("/admin/publish-tokens");
      return publishTokensResponseSchema.parse(response.data).publishTokens;
    },
    async getPublishToken(name: string) {
      const response = await http.get(`/admin/publish-tokens/${encodeURIComponent(name)}`);
      return publishTokenSchema.parse(response.data);
    },
    async createPublishToken(input: CreatePublishTokenInput) {
      const response = await http.post("/admin/publish-tokens", input);
      return publishTokenCreateResponseSchema.parse(response.data);
    },
    async revokePublishToken(name: string) {
      const response = await http.post(`/admin/publish-tokens/${encodeURIComponent(name)}/revoke`);
      return publishTokenSchema.parse(response.data);
    },
    async rotatePublishToken(name: string) {
      const response = await http.post(`/admin/publish-tokens/${encodeURIComponent(name)}/rotate`);
      return publishTokenCreateResponseSchema.parse(response.data);
    },
    async deletePublishToken(name: string) {
      await http.delete(`/admin/publish-tokens/${encodeURIComponent(name)}`);
    },
  };
}
