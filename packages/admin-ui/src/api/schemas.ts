import { z } from "zod";
import type { PluginClientHelperActionManifest } from "@axis-repository/core/plugin-manifests";

export const repositoryVisibilitySchema = z.enum(["private", "public"]);
export const repositoryKindSchema = z.enum(["hosted", "proxy", "group"]);

export const repositoryClientHelperResponseKindSchema = z.enum(["json", "shell", "text"]);

export const repositoryClientHelperActionSchema = z.object({
  name: z.string(),
  label: z.string(),
  responseKind: repositoryClientHelperResponseKindSchema,
  defaultOpen: z.boolean(),
  public: z.boolean(),
  displayPath: z.string().optional(),
});

export const resolvedPluginIconSchema = z.object({
  title: z.string(),
  accentColor: z.string(),
  inlineSvg: z.string(),
});

export const repositorySchema = z.object({
  id: z.string(),
  name: z.string(),
  ecosystem: z.string(),
  kind: repositoryKindSchema.default("hosted"),
  visibility: repositoryVisibilitySchema,
  config: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const repositoriesResponseSchema = z.object({
  repositories: z.array(repositorySchema),
});

export const adminPrincipalSchema = z.object({
  type: z.literal("admin"),
  subject: z.string(),
  username: z.string(),
  role: z.literal("owner"),
  scopes: z.array(z.string()),
  sessionId: z.string(),
});

export const adminAuthResponseSchema = z.object({
  accessToken: z.string(),
  accessTokenExpiresAt: z.string(),
  principal: adminPrincipalSchema,
});

export const adminUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  displayName: z.string(),
  role: z.literal("owner"),
  createdAt: z.string(),
  updatedAt: z.string(),
  disabledAt: z.string().optional(),
});

export const principalRefSchema = z.object({
  type: z.literal("admin-user"),
  subject: z.string(),
  displayName: z.string(),
});

export const adminUsersResponseSchema = z.object({
  users: z.array(adminUserSchema),
  canCreateUsers: z.boolean(),
});

export const repositoryObjectDirectorySchema = z.object({
  name: z.string(),
  path: z.string(),
});

export const repositoryObjectSchema = z.object({
  name: z.string(),
  path: z.string(),
  size: z.number().optional(),
  contentType: z.string().optional(),
  etag: z.string().optional(),
});

export const repositoryObjectDetailSchema = repositoryObjectSchema.extend({
  objectKey: z.string(),
  repositoryUrl: z.string(),
});

export const repositoryObjectsResponseSchema = z.object({
  prefix: z.string(),
  directories: z.array(repositoryObjectDirectorySchema),
  objects: z.array(repositoryObjectSchema),
  cursor: z.string().optional(),
  truncated: z.boolean(),
});

export const repositoryObjectDetailResponseSchema = z.object({
  object: repositoryObjectDetailSchema,
});

export const repositoryArtifactSchema = z.object({
  id: z.string(),
  repositoryName: z.string(),
  ecosystem: z.string(),
  identity: z.string(),
  /** What this is a version of; only the ecosystem knows what that means. */
  family: z.string().optional(),
  name: z.string(),
  version: z.string().optional(),
  summary: z.string(),
  primaryObjectKey: z.string().optional(),
  objectKeys: z.array(z.string()),
  metadata: z.record(z.string(), z.unknown()),
  publishedAt: z.string(),
  updatedAt: z.string(),
  publishSessionId: z.string().optional(),
});

export const repositoryArtifactsResponseSchema = z.object({
  artifacts: z.array(repositoryArtifactSchema),
  cursor: z.string().optional(),
  truncated: z.boolean(),
});

export const repositoryArtifactFamilySchema = z.object({
  key: z.string(),
  repositoryName: z.string(),
  ecosystem: z.string(),
  name: z.string(),
  latestVersion: z.string().optional(),
  latestSummary: z.string(),
  latestPublishedAt: z.string(),
  updatedAt: z.string(),
  artifactCount: z.number(),
  versionCount: z.number(),
  latestArtifact: repositoryArtifactSchema,
});

export const repositoryArtifactFamiliesResponseSchema = z.object({
  families: z.array(repositoryArtifactFamilySchema),
  totalFamilies: z.number(),
  totalArtifacts: z.number(),
  cursor: z.string().optional(),
  truncated: z.boolean(),
});

export const backgroundJobSchema = z.object({
  id: z.string(),
  type: z.string(),
  status: z.enum(["pending", "running", "succeeded", "failed", "canceling", "canceled"]),
  subject: z.object({
    type: z.enum(["repository", "publish-session", "upload", "artifact", "system"]),
    id: z.string(),
    repositoryName: z.string().optional(),
  }),
  repositoryName: z.string().optional(),
  priority: z.number(),
  attempts: z.number(),
  maxAttempts: z.number().optional(),
  requestedAt: z.string(),
  scheduledAt: z.string(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  lastHeartbeatAt: z.string().optional(),
  progress: z.object({
    current: z.number().optional(),
    total: z.number().optional(),
    message: z.string().optional(),
  }).optional(),
  result: z.record(z.string(), z.unknown()).optional(),
  failure: z.object({
    message: z.string(),
    failedAt: z.string(),
    retryable: z.boolean(),
  }).optional(),
  cancelRequestedAt: z.string().optional(),
});

export const backgroundJobsResponseSchema = z.object({
  jobs: z.array(backgroundJobSchema),
  total: z.number(),
});

export const backgroundJobResponseSchema = z.object({
  job: backgroundJobSchema,
});

export const repositoryIndexJobResponseSchema = z.object({
  job: backgroundJobSchema,
});

export const repositoryPluginSchema = z.object({
  ecosystem: z.string(),
  name: z.string(),
  version: z.string(),
  enabled: z.boolean().optional(),
  catalogEnabled: z.boolean().optional(),
  enabledOverride: z.boolean().nullable().optional(),
  experimental: z.boolean().optional(),
  runtime: z.boolean().optional(),
  adminUi: z.boolean().optional(),
  icon: resolvedPluginIconSchema.optional(),
  capabilities: z.array(z.string()),
  repositoryKinds: z.array(repositoryKindSchema).default(["hosted"]),
  clientHelpers: z.object({
    namespace: z.string(),
    actions: z.array(repositoryClientHelperActionSchema),
  }).optional(),
});

export const repositoryPluginsResponseSchema = z.object({
  plugins: z.array(repositoryPluginSchema),
});

export const leftoverBootstrapCredentialSchema = z.object({
  name: z.string(),
  sensitive: z.boolean(),
  removal: z.string(),
  command: z.string(),
});

export const deploymentResponseSchema = z.object({
  leftoverBootstrapCredentials: z.array(leftoverBootstrapCredentialSchema),
});

export const proxyFileByteCacheSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  maxBytes: z.number().optional(),
  maxTotalBytes: z.number().optional(),
  ttlSeconds: z.number().optional(),
  respectUpstreamCacheControl: z.boolean().optional(),
});

export const proxyOperationalPolicySettingsSchema = z.object({
  upstreamFetchTimeoutMs: z.number().optional(),
  upstreamRequestRetries: z.number().optional(),
  upstreamRetryBaseDelayMs: z.number().optional(),
  upstreamRetryMaxDelayMs: z.number().optional(),
  indexCatalogBatchSize: z.number().optional(),
  indexProjectDetailBatchSize: z.number().optional(),
  failedProjectSampleLimit: z.number().optional(),
  fileByteCache: proxyFileByteCacheSettingsSchema.optional(),
});

export const runtimeSettingsOverridesSchema = z.object({
  operationalPolicy: z.object({
    proxy: proxyOperationalPolicySettingsSchema.optional(),
  }).optional(),
});

export const runtimeSettingsSchema = z.object({
  operationalPolicy: z.object({
    proxy: z.object({
      upstreamFetchTimeoutMs: z.number(),
      upstreamRequestRetries: z.number(),
      upstreamRetryBaseDelayMs: z.number(),
      upstreamRetryMaxDelayMs: z.number(),
      indexCatalogBatchSize: z.number(),
      indexProjectDetailBatchSize: z.number(),
      failedProjectSampleLimit: z.number(),
      fileByteCache: z.object({
        enabled: z.boolean(),
        maxBytes: z.number(),
        maxTotalBytes: z.number(),
        ttlSeconds: z.number(),
        respectUpstreamCacheControl: z.boolean(),
      }),
    }),
  }),
});

export const runtimeSettingsResponseSchema = z.object({
  settings: runtimeSettingsSchema,
  overrides: runtimeSettingsOverridesSchema,
});

export const publishTokenSchema = z.object({
  id: z.string(),
  name: z.string(),
  permissions: z.array(z.string()),
  repositories: z.array(z.string()),
  ecosystemScopes: z.record(z.string(), z.unknown()),
  signingKeyIds: z.array(z.string()),
  owner: principalRefSchema.optional(),
  createdAt: z.string(),
  expiresAt: z.string().optional(),
  rotatedAt: z.string().optional(),
  revokedAt: z.string().optional(),
});

export const publishTokensResponseSchema = z.object({
  publishTokens: z.array(publishTokenSchema),
});

export const publishTokenCreateResponseSchema = z.object({
  token: publishTokenSchema,
  secret: z.string(),
});

export const publishSessionStatusSchema = z.enum([
  "pending_uploads",
  "ready",
  "finalize_queued",
  "finalizing",
  "finalized",
  "finalize_failed",
  "failed",
]);

export const tokenPrincipalSchema = z.object({
  tokenId: z.string(),
  name: z.string(),
  permissions: z.array(z.string()),
  repositories: z.array(z.string()),
  ecosystemScopes: z.record(z.string(), z.unknown()),
  signingKeyIds: z.array(z.string()),
  owner: principalRefSchema.optional(),
});

export const publishArtifactSchema = z.object({
  filename: z.string(),
  size: z.number(),
  sha256: z.string(),
  contentType: z.string(),
  metadata: z.record(z.string(), z.unknown()),
});

export const uploadTargetSchema = z.object({
  uploadId: z.string(),
  filename: z.string(),
  objectKey: z.string(),
  method: z.literal("PUT"),
  url: z.string(),
  headers: z.record(z.string(), z.string()),
  expiresAt: z.string(),
});

export const verifiedUploadSchema = z.object({
  uploadId: z.string(),
  objectKey: z.string(),
  size: z.number(),
  sha256: z.string(),
  verifiedAt: z.string(),
});

export const publishResultSchema = z.object({
  objects: z.array(z.object({
    key: z.string(),
    contentType: z.string(),
  })),
  publishedAt: z.string(),
});

export const publishFailureSchema = z.object({
  message: z.string(),
  failedAt: z.string(),
});

// Reading a session back never returns presigned upload URLs or the creating
// token's authorization detail; only the create response carries them.
export const uploadTargetSummarySchema = uploadTargetSchema.omit({ url: true, headers: true });

export const tokenPrincipalSummarySchema = z.object({
  tokenId: z.string(),
  name: z.string(),
  owner: principalRefSchema.optional(),
});

export const publishSessionSchema = z.object({
  id: z.string(),
  repositoryName: z.string(),
  ecosystem: z.string(),
  status: publishSessionStatusSchema,
  requestedBy: tokenPrincipalSummarySchema,
  artifacts: z.array(publishArtifactSchema),
  uploads: z.array(uploadTargetSummarySchema),
  verifiedUploads: z.array(verifiedUploadSchema),
  createdAt: z.string(),
  expiresAt: z.string(),
  publishStartedAt: z.string().optional(),
  finalizingStartedAt: z.string().optional(),
  finalizedAt: z.string().optional(),
  failure: publishFailureSchema.optional(),
  publishResult: publishResultSchema.optional(),
});

export const createdPublishSessionSchema = publishSessionSchema.extend({
  uploads: z.array(uploadTargetSchema),
});

export const publishSessionsResponseSchema = z.object({
  sessions: z.array(publishSessionSchema),
});

export const publishFinalizeResponseSchema = z.object({
  session: publishSessionSchema,
  job: backgroundJobSchema,
});

export const objectDeleteActivitySchema = z.object({
  id: z.string(),
  repositoryName: z.string(),
  type: z.literal("object.delete"),
  actor: z.literal("admin"),
  summary: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});

export const objectUpdateActivitySchema = z.object({
  id: z.string(),
  repositoryName: z.string(),
  type: z.literal("object.update"),
  actor: z.literal("admin"),
  summary: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});

export const artifactIndexRebuildActivitySchema = z.object({
  id: z.string(),
  repositoryName: z.string(),
  type: z.literal("artifact-index.rebuild"),
  actor: z.literal("admin"),
  summary: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});

export const artifactDeleteActivitySchema = z.object({
  id: z.string(),
  repositoryName: z.string(),
  type: z.literal("artifact.delete"),
  actor: z.literal("admin"),
  summary: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});

export const publishActivitySchema = z.object({
  id: z.string(),
  repositoryName: z.string(),
  type: z.literal("publish"),
  actor: z.literal("publish-token"),
  summary: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  session: publishSessionSchema,
});

export const repositoryActivitySchema = z.union([
  objectDeleteActivitySchema,
  objectUpdateActivitySchema,
  artifactIndexRebuildActivitySchema,
  artifactDeleteActivitySchema,
  publishActivitySchema,
]);

export const repositoryActivitiesResponseSchema = z.object({
  activities: z.array(repositoryActivitySchema),
  cursor: z.string().optional(),
  truncated: z.boolean(),
});

export const repositoryObjectDeleteResponseSchema = z.object({
  activity: objectDeleteActivitySchema,
  job: backgroundJobSchema,
});

export const repositoryArtifactDeleteResponseSchema = z.object({
  job: backgroundJobSchema,
});

export const signingKeySchema = z.object({
  id: z.string(),
  repositoryName: z.string(),
  name: z.string(),
  publicKeyArmored: z.string(),
  fingerprint: z.string(),
  keyId: z.string(),
  createdAt: z.string(),
  revokedAt: z.string().nullable(),
});

export const signingKeysResponseSchema = z.object({
  signingKeys: z.array(signingKeySchema),
});

export const adminSessionSchema = z.object({
  ok: z.literal(true),
  principal: adminPrincipalSchema,
});

export type Repository = z.infer<typeof repositorySchema>;
export type AdminPrincipal = z.infer<typeof adminPrincipalSchema>;
export type PrincipalRef = z.infer<typeof principalRefSchema>;
export type AdminAuthResponse = z.infer<typeof adminAuthResponseSchema>;
export type AdminUser = z.infer<typeof adminUserSchema>;
export type RepositoryObjectDirectory = z.infer<typeof repositoryObjectDirectorySchema>;
export type RepositoryObject = z.infer<typeof repositoryObjectSchema>;
export type RepositoryObjectDetail = z.infer<typeof repositoryObjectDetailSchema>;
export type RepositoryObjectsResponse = z.infer<typeof repositoryObjectsResponseSchema>;
export type RepositoryArtifact = z.infer<typeof repositoryArtifactSchema>;
export type RepositoryArtifactFamily = z.infer<typeof repositoryArtifactFamilySchema>;
export type RepositoryArtifactsResponse = z.infer<typeof repositoryArtifactsResponseSchema>;
export type RepositoryArtifactFamiliesResponse = z.infer<typeof repositoryArtifactFamiliesResponseSchema>;
export type BackgroundJob = z.infer<typeof backgroundJobSchema>;
export type RepositoryClientHelperAction = PluginClientHelperActionManifest;
export type RepositoryPlugin = z.infer<typeof repositoryPluginSchema>;
export type RepositoryVisibility = z.infer<typeof repositoryVisibilitySchema>;
export type RepositoryKind = z.infer<typeof repositoryKindSchema>;
export type PublishToken = z.infer<typeof publishTokenSchema>;
export type PublishTokenCreateResponse = z.infer<typeof publishTokenCreateResponseSchema>;
export type PublishSession = z.infer<typeof publishSessionSchema>;
export type PublishFinalizeResponse = z.infer<typeof publishFinalizeResponseSchema>;
export type CreatedPublishSession = z.infer<typeof createdPublishSessionSchema>;
export type PublishSessionStatus = z.infer<typeof publishSessionStatusSchema>;
export type PublishArtifact = z.infer<typeof publishArtifactSchema>;
export type UploadTarget = z.infer<typeof uploadTargetSchema>;
export type RepositoryActivity = z.infer<typeof repositoryActivitySchema>;
export type SigningKey = z.infer<typeof signingKeySchema>;
