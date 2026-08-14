import {
  RepositoryActivityService,
  AdminAuthService,
  PublishSessionService,
  PublishTokenService,
  PluginPolicyService,
  RuntimeSettingsService,
  RepositoryService,
  type BackgroundTaskScheduler,
  type Clock,
  type RepositoryWriteLocker,
  type RuntimeOperationalPolicySettings,
  type StateStore,
} from "@axis-repository/core";
import { WebCryptoRandomId, Sha256SecretHasher, Pbkdf2PasswordHasher } from "../crypto";
import { HmacAdminAccessTokenCodec } from "../auth/admin-auth";
import { createDefaultArtifactPlugins } from "../plugins/default-plugins";
import { createD1StateStore } from "../storage/d1-state";
import type { AppDependencies } from "./dev-dependencies";
import { SameOriginUploadBroker } from "../uploads/same-origin-upload-broker";
import { R2PresignedUploadBroker } from "../uploads/r2-upload-broker";
import { R2PresignedDownloadSigner } from "../storage/object-download-url";
import { MemoryRepositoryObjectStore, R2RepositoryObjectStore } from "../storage/repository-object-store";
import {
  PluginPublishSessionService,
  PluginRepositoryArtifactIndexService,
  PluginRepositoryGroupDependencyService,
  PluginRepositoryService,
} from "./runtime-services";
import { RepositoryIndexBackgroundJobService } from "./repository-index-background-job-service";
import { RepositoryMaintenanceJobService } from "./repository-maintenance-job-service";
import { PublishFinalizeJobService } from "./publish-finalize-job-service";
import { BackgroundJobService } from "./background-job-service";
import { BackgroundJobDispatcher } from "./background-job-dispatcher";
import { StagingUploadGcJobService } from "./staging-upload-gc-job-service";
import { RepositoryArtifactDeleteJobService } from "./repository-artifact-delete-job-service";
import { RepositoryDeleteJobService } from "./repository-delete-job-service";
import { RepositoryProxyCachePurgeJobService } from "./repository-proxy-cache-purge-job-service";
import { SecretEncryption } from "../storage/secret-encryption";
import { RepositorySecretService } from "../storage/repository-secret-service";
import { D1RepositoryWriteLock } from "./repository-write-lock";
import { assertBackgroundJobQueueConfiguration } from "./background-job-queue";

export interface AxisEnv {
  AXIS_SHARED_STATE?: D1Database;
  AXIS_BACKGROUND_JOBS?: Queue;
  AXIS_OBJECTS?: R2Bucket;
  AXIS_ADMIN_USERNAME?: string;
  AXIS_ADMIN_PASSWORD_HASH?: string;
  AXIS_ADMIN_PASSWORD?: string;
  AXIS_SESSION_SECRET?: string;
  TOKEN_HASH_PEPPER?: string;
  SIGNING_KEY_ENCRYPTION_SECRET?: string;
  R2_ACCOUNT_ID?: string;
  R2_BUCKET_NAME?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  UPLOAD_URL_TTL_SECONDS?: string;
  DOWNLOAD_URL_TTL_SECONDS?: string;
  UPLOAD_BACKEND?: string;
  ADMIN_UI_API_BASE_URL?: string;
  AXIS_ARTIFACT_ORIGIN?: string;
  AXIS_PROXY_UPSTREAM_FETCH_TIMEOUT_MS?: string;
  AXIS_PROXY_UPSTREAM_REQUEST_RETRIES?: string;
  AXIS_PROXY_UPSTREAM_RETRY_BASE_DELAY_MS?: string;
  AXIS_PROXY_UPSTREAM_RETRY_MAX_DELAY_MS?: string;
  AXIS_PROXY_INDEX_CATALOG_BATCH_SIZE?: string;
  AXIS_PROXY_INDEX_PROJECT_DETAIL_BATCH_SIZE?: string;
  AXIS_PROXY_FAILED_PROJECT_SAMPLE_LIMIT?: string;
  AXIS_PROXY_FILE_BYTE_CACHE_ENABLED?: string;
  AXIS_PROXY_FILE_BYTE_CACHE_MAX_BYTES?: string;
  AXIS_PROXY_FILE_BYTE_CACHE_MAX_TOTAL_BYTES?: string;
  AXIS_PROXY_FILE_BYTE_CACHE_TTL_SECONDS?: string;
  AXIS_PROXY_RESPECT_UPSTREAM_CACHE_CONTROL?: string;
}

type UploadBackend = "r2" | "local-r2" | "memory";

function requiredEnv(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required for the Cloudflare runtime`);
  }
  return value;
}

function optionalPositiveInteger(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function optionalNonNegativeInteger(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

function optionalBoolean(value: string | undefined, name: string): boolean | undefined {
  if (value === undefined || value === "") return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function deploymentOperationalPolicyFromEnv(env: AxisEnv): RuntimeOperationalPolicySettings | undefined {
  const upstreamFetchTimeoutMs = optionalPositiveInteger(
    env.AXIS_PROXY_UPSTREAM_FETCH_TIMEOUT_MS,
    "AXIS_PROXY_UPSTREAM_FETCH_TIMEOUT_MS",
  );
  const indexCatalogBatchSize = optionalPositiveInteger(
    env.AXIS_PROXY_INDEX_CATALOG_BATCH_SIZE,
    "AXIS_PROXY_INDEX_CATALOG_BATCH_SIZE",
  );
  const indexProjectDetailBatchSize = optionalPositiveInteger(
    env.AXIS_PROXY_INDEX_PROJECT_DETAIL_BATCH_SIZE,
    "AXIS_PROXY_INDEX_PROJECT_DETAIL_BATCH_SIZE",
  );
  const failedProjectSampleLimit = optionalNonNegativeInteger(
    env.AXIS_PROXY_FAILED_PROJECT_SAMPLE_LIMIT,
    "AXIS_PROXY_FAILED_PROJECT_SAMPLE_LIMIT",
  );
  const upstreamRequestRetries = optionalNonNegativeInteger(
    env.AXIS_PROXY_UPSTREAM_REQUEST_RETRIES,
    "AXIS_PROXY_UPSTREAM_REQUEST_RETRIES",
  );
  const upstreamRetryBaseDelayMs = optionalNonNegativeInteger(
    env.AXIS_PROXY_UPSTREAM_RETRY_BASE_DELAY_MS,
    "AXIS_PROXY_UPSTREAM_RETRY_BASE_DELAY_MS",
  );
  const upstreamRetryMaxDelayMs = optionalNonNegativeInteger(
    env.AXIS_PROXY_UPSTREAM_RETRY_MAX_DELAY_MS,
    "AXIS_PROXY_UPSTREAM_RETRY_MAX_DELAY_MS",
  );
  const fileByteCacheEnabled = optionalBoolean(
    env.AXIS_PROXY_FILE_BYTE_CACHE_ENABLED,
    "AXIS_PROXY_FILE_BYTE_CACHE_ENABLED",
  );
  const fileByteCacheMaxBytes = optionalNonNegativeInteger(
    env.AXIS_PROXY_FILE_BYTE_CACHE_MAX_BYTES,
    "AXIS_PROXY_FILE_BYTE_CACHE_MAX_BYTES",
  );
  const fileByteCacheMaxTotalBytes = optionalNonNegativeInteger(
    env.AXIS_PROXY_FILE_BYTE_CACHE_MAX_TOTAL_BYTES,
    "AXIS_PROXY_FILE_BYTE_CACHE_MAX_TOTAL_BYTES",
  );
  const fileByteCacheTtlSeconds = optionalNonNegativeInteger(
    env.AXIS_PROXY_FILE_BYTE_CACHE_TTL_SECONDS,
    "AXIS_PROXY_FILE_BYTE_CACHE_TTL_SECONDS",
  );
  const respectUpstreamCacheControl = optionalBoolean(
    env.AXIS_PROXY_RESPECT_UPSTREAM_CACHE_CONTROL,
    "AXIS_PROXY_RESPECT_UPSTREAM_CACHE_CONTROL",
  );
  const fileByteCache = {
    ...(fileByteCacheEnabled === undefined ? {} : { enabled: fileByteCacheEnabled }),
    ...(fileByteCacheMaxBytes === undefined ? {} : { maxBytes: fileByteCacheMaxBytes }),
    ...(fileByteCacheMaxTotalBytes === undefined ? {} : { maxTotalBytes: fileByteCacheMaxTotalBytes }),
    ...(fileByteCacheTtlSeconds === undefined ? {} : { ttlSeconds: fileByteCacheTtlSeconds }),
    ...(respectUpstreamCacheControl === undefined ? {} : { respectUpstreamCacheControl }),
  };
  const proxy = {
    ...(upstreamFetchTimeoutMs === undefined ? {} : { upstreamFetchTimeoutMs }),
    ...(upstreamRequestRetries === undefined ? {} : { upstreamRequestRetries }),
    ...(upstreamRetryBaseDelayMs === undefined ? {} : { upstreamRetryBaseDelayMs }),
    ...(upstreamRetryMaxDelayMs === undefined ? {} : { upstreamRetryMaxDelayMs }),
    ...(indexCatalogBatchSize === undefined ? {} : { indexCatalogBatchSize }),
    ...(indexProjectDetailBatchSize === undefined ? {} : { indexProjectDetailBatchSize }),
    ...(failedProjectSampleLimit === undefined ? {} : { failedProjectSampleLimit }),
    ...(Object.keys(fileByteCache).length === 0 ? {} : { fileByteCache }),
  };
  return Object.keys(proxy).length > 0
    ? { proxy }
    : undefined;
}

function parseUploadBackend(value: string | undefined): UploadBackend {
  if (value === undefined || value === "" || value === "r2") {
    return "r2";
  }
  if (value === "memory") {
    return "memory";
  }
  if (value === "local-r2") {
    return "local-r2";
  }
  throw new Error("UPLOAD_BACKEND must be one of: r2, local-r2, memory");
}

/**
 * Origin repository objects are served from, when it differs from the admin
 * origin. Must be a bare origin: a path or query here would silently produce
 * broken sources.list lines and index URLs.
 */
function parseArtifactOrigin(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("AXIS_ARTIFACT_ORIGIN must be an absolute origin such as https://cdn.example");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("AXIS_ARTIFACT_ORIGIN must use http or https");
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("AXIS_ARTIFACT_ORIGIN must not include a path, query, or fragment");
  }
  return parsed.origin;
}

function requiredR2Bucket(value: R2Bucket | undefined): R2Bucket {
  if (!value) {
    throw new Error("AXIS_OBJECTS is required for the Cloudflare runtime");
  }
  return value;
}

function bootstrapOwnerFromEnv(env: AxisEnv): { username: string; password?: string; passwordHash?: string } | undefined {
  if (!env.AXIS_ADMIN_USERNAME) {
    return undefined;
  }
  const username = env.AXIS_ADMIN_USERNAME;
  if (env.AXIS_ADMIN_PASSWORD_HASH !== undefined && env.AXIS_ADMIN_PASSWORD_HASH !== "") {
    if (!env.AXIS_ADMIN_PASSWORD_HASH.startsWith("pbkdf2-sha256$")) {
      throw new Error("AXIS_ADMIN_PASSWORD_HASH must use pbkdf2-sha256 format");
    }
    return { username, passwordHash: env.AXIS_ADMIN_PASSWORD_HASH };
  }
  if (!env.AXIS_ADMIN_PASSWORD) {
    return undefined;
  }
  return {
    username,
    password: env.AXIS_ADMIN_PASSWORD,
  };
}

export function createCloudflareRuntimeDependencies(
  env: AxisEnv,
  options: {
    scheduleBackgroundJobs?: () => Promise<void>;
    backgroundTasks?: BackgroundTaskScheduler;
  } = {},
): AppDependencies {
  if (!env.AXIS_SHARED_STATE) {
    throw new Error("AXIS_SHARED_STATE is required for the Cloudflare runtime");
  }
  return createRuntimeDependencies(
    createD1StateStore(env.AXIS_SHARED_STATE),
    env,
    options,
    new D1RepositoryWriteLock(env.AXIS_SHARED_STATE),
  );
}

export function createRuntimeDependencies(
  state: StateStore,
  env: AxisEnv,
  options: {
    scheduleBackgroundJobs?: () => Promise<void>;
    backgroundTasks?: BackgroundTaskScheduler;
  },
  writeLock: RepositoryWriteLocker,
): AppDependencies {
  assertBackgroundJobQueueConfiguration(env);
  if (!env.TOKEN_HASH_PEPPER) {
    throw new Error("TOKEN_HASH_PEPPER is required for the Cloudflare runtime");
  }
  if (!env.SIGNING_KEY_ENCRYPTION_SECRET) {
    throw new Error("SIGNING_KEY_ENCRYPTION_SECRET is required for the Cloudflare runtime");
  }

  const clock: Clock = { now: () => new Date() };
  const randomId = new WebCryptoRandomId();
  const hasher = new Sha256SecretHasher(env.TOKEN_HASH_PEPPER);
  const passwordHasher = new Pbkdf2PasswordHasher(env.TOKEN_HASH_PEPPER);
  const bootstrapOwner = bootstrapOwnerFromEnv(env);
  const adminAuthService = new AdminAuthService({
    state,
    clock,
    randomId,
    hasher,
    passwordHasher,
    ...(bootstrapOwner === undefined ? {} : { bootstrapOwner }),
    accessTokens: new HmacAdminAccessTokenCodec(requiredEnv(env.AXIS_SESSION_SECRET, "AXIS_SESSION_SECRET")),
  });
  const encryption = new SecretEncryption(env.SIGNING_KEY_ENCRYPTION_SECRET);
  const repositorySecrets = new RepositorySecretService({
    state,
    clock,
    randomId,
    encryption,
  });
  const deploymentOperationalPolicy = deploymentOperationalPolicyFromEnv(env);
  const runtimeSettingsService = new RuntimeSettingsService({
    state,
    ...(deploymentOperationalPolicy === undefined ? {} : { deploymentOperationalPolicy }),
  });
  const uploadUrlTtlSeconds = optionalPositiveInteger(env.UPLOAD_URL_TTL_SECONDS, "UPLOAD_URL_TTL_SECONDS");
  const downloadUrlTtlSeconds = optionalPositiveInteger(env.DOWNLOAD_URL_TTL_SECONDS, "DOWNLOAD_URL_TTL_SECONDS");
  const uploadBackend = parseUploadBackend(env.UPLOAD_BACKEND);
  const objectStore = uploadBackend === "memory"
    ? new MemoryRepositoryObjectStore()
    : new R2RepositoryObjectStore(requiredR2Bucket(env.AXIS_OBJECTS));
  const uploadBroker = uploadBackend === "memory" || uploadBackend === "local-r2"
    ? new SameOriginUploadBroker(objectStore)
    : new R2PresignedUploadBroker({
      bucket: requiredR2Bucket(env.AXIS_OBJECTS),
      accountId: requiredEnv(env.R2_ACCOUNT_ID, "R2_ACCOUNT_ID"),
      bucketName: requiredEnv(env.R2_BUCKET_NAME, "R2_BUCKET_NAME"),
      accessKeyId: requiredEnv(env.R2_ACCESS_KEY_ID, "R2_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnv(env.R2_SECRET_ACCESS_KEY, "R2_SECRET_ACCESS_KEY"),
      ...(uploadUrlTtlSeconds === undefined ? {} : { uploadUrlTtlSeconds }),
    });
  // Downloads are signed with the same credentials as uploads, so they are
  // handed out wherever those exist. A local or in-memory bucket has nothing
  // to sign against, and the Worker serves those bytes itself.
  const downloadSigner = uploadBackend === "r2"
    ? new R2PresignedDownloadSigner({
      accountId: requiredEnv(env.R2_ACCOUNT_ID, "R2_ACCOUNT_ID"),
      bucketName: requiredEnv(env.R2_BUCKET_NAME, "R2_BUCKET_NAME"),
      accessKeyId: requiredEnv(env.R2_ACCESS_KEY_ID, "R2_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnv(env.R2_SECRET_ACCESS_KEY, "R2_SECRET_ACCESS_KEY"),
      ...(downloadUrlTtlSeconds === undefined ? {} : { ttlSeconds: downloadUrlTtlSeconds }),
    })
    : undefined;
  const repositoryRuntimePlugins = createDefaultArtifactPlugins({
    objectStore,
    secrets: repositorySecrets,
    proxyPolicyFor: async () => (await runtimeSettingsService.get()).operationalPolicy.proxy,
  });
  const repositoryService = new RepositoryService({ state, clock, randomId });
  const pluginPolicyService = new PluginPolicyService({ state });
  const repositoryActivityService = new RepositoryActivityService({ state, clock, randomId });
  const publishSessionService = new PublishSessionService({
    state,
    uploadBroker,
    artifactPublisher: repositoryRuntimePlugins,
    clock,
    randomId,
  });
  const repositoryArtifactIndexService = new PluginRepositoryArtifactIndexService({
    repositoryService,
    plugins: repositoryRuntimePlugins,
    repositoryObjectStore: objectStore,
    repositoryArtifactStore: state.repositoryArtifacts,
    clock,
    writeLock,
  });
  const repositoryGroupDependencyService = new PluginRepositoryGroupDependencyService({
    repositoryService,
    plugins: repositoryRuntimePlugins,
  });
  const repositoryIndexJobService = new RepositoryIndexBackgroundJobService({
    state,
    repositoryService,
    repositoryActivityService,
    groupDependencyResolver: repositoryGroupDependencyService,
    repositoryArtifactIndexService,
    clock,
  });
  const repositoryMaintenanceJobService = new RepositoryMaintenanceJobService({
    state,
    repositoryService,
    plugins: repositoryRuntimePlugins,
    repositoryObjectStore: objectStore,
    writeLock,
    clock,
  });
  const pluginPublishSessionService = new PluginPublishSessionService({
    publishSessionService,
    repositoryService,
    plugins: repositoryRuntimePlugins,
    pluginPolicyService,
    repositoryActivityService,
    repositoryArtifactStore: state.repositoryArtifacts,
    repositoryObjectStore: objectStore,
    writeLock,
  });
  const pluginRepositoryService = new PluginRepositoryService({
    repositoryService,
    plugins: repositoryRuntimePlugins,
    pluginPolicyService,
  });
  const publishFinalizeJobService = new PublishFinalizeJobService({
    state,
    publishSessionService: pluginPublishSessionService,
    clock,
  });
  const repositoryArtifactDeleteJobService = new RepositoryArtifactDeleteJobService({
    state,
    repositoryService,
    repositoryArtifactStore: state.repositoryArtifacts,
    repositoryArtifactIndexService,
    repositoryActivityService,
    clock,
  });
  const repositoryDeleteJobService = new RepositoryDeleteJobService({
    state,
    repositoryService: pluginRepositoryService,
    repositoryObjectStore: objectStore,
    clock,
  });
  const repositoryProxyCachePurgeJobService = new RepositoryProxyCachePurgeJobService({
    state,
    repositoryService: pluginRepositoryService,
    repositoryObjectStore: objectStore,
    clock,
  });
  const stagingUploadGcJobService = new StagingUploadGcJobService({
    state,
    objectStore,
    clock,
    sessionTtlMs: publishSessionService.ttlSeconds * 1000,
  });
  const backgroundJobService = new BackgroundJobService({
    state,
    clock,
    repositoryIndexJobService,
    repositoryMaintenanceJobService,
    publishFinalizeJobService,
    stagingUploadGcJobService,
    repositoryArtifactDeleteJobService,
    repositoryDeleteJobService,
    repositoryProxyCachePurgeJobService,
  });
  const backgroundJobDispatcher = new BackgroundJobDispatcher({
    state,
    clock,
    runners: [
      {
        supports: (job) => job.type === "publish.finalize",
        run: (job) => publishFinalizeJobService.runBackgroundJob(job),
      },
      {
        supports: (job) => job.type.startsWith("repository.index."),
        run: (job) => repositoryIndexJobService.runBackgroundJob(job),
      },
      {
        supports: (job) => job.type === "repository.maintenance",
        run: (job) => repositoryMaintenanceJobService.runBackgroundJob(job),
      },
      {
        supports: (job) => job.type === "repository.artifact.delete",
        run: (job) => repositoryArtifactDeleteJobService.runBackgroundJob(job),
      },
      {
        supports: (job) => job.type === "repository.delete",
        run: (job) => repositoryDeleteJobService.runBackgroundJob(job),
      },
      {
        supports: (job) => job.type === "repository.proxy-cache.purge",
        run: (job) => repositoryProxyCachePurgeJobService.runBackgroundJob(job),
      },
      {
        supports: (job) => job.type === "storage.staging-upload-gc",
        run: async (job) => {
          await stagingUploadGcJobService.runBackgroundJob(job);
        },
      },
    ],
  });

  const artifactOrigin = parseArtifactOrigin(env.AXIS_ARTIFACT_ORIGIN);

  return {
    adminAuthService,
    ...(artifactOrigin === undefined ? {} : { artifactOrigin }),
    adminUiRuntimeConfig: {
      apiBaseUrl: env.ADMIN_UI_API_BASE_URL ?? "",
      // Only the presigned backend uploads cross-origin; the same-origin
      // brokers upload back to this worker.
      ...(uploadBackend === "r2" && env.R2_ACCOUNT_ID
        ? { uploadOrigin: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` }
        : {}),
    },
    deploymentCapabilities: {
      provider: { id: "cloudflare", name: "Cloudflare Workers" },
      uploads: uploadBackend === "r2"
        ? {
          strategy: "direct-object-storage",
          directObjectStorage: true,
        }
        : {
          strategy: "worker-relay",
          directObjectStorage: false,
          workerRequestBodyLimitBytes: 100 * 1024 * 1024,
        },
      backgroundJobs: {
        executor: "queue",
        recurringScheduler: "cron",
      },
    },
    repositoryService: pluginRepositoryService,
    publishTokenService: new PublishTokenService({ state, clock, randomId, hasher }),
    publishSessionService: pluginPublishSessionService,
    backgroundJobService,
    backgroundJobDispatcher,
    stagingUploadGcJobService,
    repositoryMaintenanceJobService,
    publishFinalizeJobService,
    repositoryArtifactDeleteJobService,
    repositoryDeleteJobService,
    repositoryProxyCachePurgeJobService,
    repositoryActivityService,
    repositoryArtifactStore: state.repositoryArtifacts,
    repositoryArtifactIndexService,
    pluginPolicyService,
    runtimeSettingsService,
    repositorySecrets,
    repositoryObjectStore: objectStore,
    ...(downloadSigner ? { repositoryObjectDownloadSigner: downloadSigner } : {}),
    ...(uploadBroker instanceof SameOriginUploadBroker ? { localUploadBroker: uploadBroker } : {}),
    repositoryRuntimePlugins,
    repositoryWriteLock: writeLock,
    publishSessionTtlMs: publishSessionService.ttlSeconds * 1000,
    ...(options.backgroundTasks === undefined
      ? {}
      : { backgroundTasks: options.backgroundTasks }),
    ...(options.scheduleBackgroundJobs === undefined
      ? {}
      : { scheduleBackgroundJobs: options.scheduleBackgroundJobs }),
  };
}
