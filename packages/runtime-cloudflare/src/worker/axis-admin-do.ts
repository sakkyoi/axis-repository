import {
  RepositoryActivityService,
  AdminAuthService,
  PublishSessionService,
  PublishTokenService,
  PluginPolicyService,
  RepositoryService,
  type Clock,
} from "@axis-repository/core";
import { createApp } from "./app";
import { WebCryptoRandomId, Sha256SecretHasher, Pbkdf2PasswordHasher } from "../crypto";
import { HmacAdminAccessTokenCodec } from "../auth/admin-auth";
import { createDefaultArtifactPlugins } from "../plugins/default-plugins";
import { DurableStateStore, type DurableStorage } from "../storage/durable-state";
import type { AppDependencies } from "./dev-dependencies";
import { SameOriginUploadBroker } from "../uploads/same-origin-upload-broker";
import { R2PresignedUploadBroker } from "../uploads/r2-upload-broker";
import { R2PresignedDownloadSigner } from "../storage/object-download-url";
import { MemoryRepositoryObjectStore, R2RepositoryObjectStore } from "../storage/repository-object-store";
import { PluginPublishSessionService, PluginRepositoryArtifactIndexService, PluginRepositoryService } from "./runtime-services";
import { SecretEncryption } from "../storage/secret-encryption";
import { RepositorySecretService } from "../storage/repository-secret-service";
import { RepositoryWriteLock } from "./repository-write-lock";
import {
  MAINTENANCE_MAX_INTERVAL_MS,
  MAINTENANCE_MIN_INTERVAL_MS,
  runRepositoryMaintenance,
} from "./repository-maintenance";

export interface AxisEnv {
  AXIS_ADMIN?: DurableObjectNamespace;
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
}

type UploadBackend = "r2" | "local-r2" | "memory";

function requiredEnv(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required for AxisAdminDO`);
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
    throw new Error("AXIS_OBJECTS is required for AxisAdminDO");
  }
  return value;
}

function bootstrapOwnerFromEnv(env: AxisEnv): { username: string; password?: string; passwordHash?: string } | undefined {
  if (!env.AXIS_ADMIN_USERNAME) {
    return undefined;
  }
  const username = env.AXIS_ADMIN_USERNAME;
  if (env.AXIS_ADMIN_PASSWORD_HASH !== undefined && env.AXIS_ADMIN_PASSWORD_HASH !== "") {
    if (
      !env.AXIS_ADMIN_PASSWORD_HASH.startsWith("sha256:")
      && !env.AXIS_ADMIN_PASSWORD_HASH.startsWith("pbkdf2-sha256$")
    ) {
      throw new Error("AXIS_ADMIN_PASSWORD_HASH must use sha256 or pbkdf2-sha256 format");
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

export function createDurableObjectDependencies(
  storage: DurableStorage,
  env: AxisEnv,
): AppDependencies {
  if (!env.TOKEN_HASH_PEPPER) {
    throw new Error("TOKEN_HASH_PEPPER is required for AxisAdminDO");
  }
  if (!env.SIGNING_KEY_ENCRYPTION_SECRET) {
    throw new Error("SIGNING_KEY_ENCRYPTION_SECRET is required for AxisAdminDO");
  }

  const state = new DurableStateStore(storage);
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
  const repositoryRuntimePlugins = createDefaultArtifactPlugins({ objectStore, secrets: repositorySecrets });
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
  const writeLock = new RepositoryWriteLock();
  const repositoryArtifactIndexService = new PluginRepositoryArtifactIndexService({
    repositoryService,
    plugins: repositoryRuntimePlugins,
    repositoryObjectStore: objectStore,
    repositoryArtifactStore: state.repositoryArtifacts,
    clock,
    writeLock,
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
    repositoryService: new PluginRepositoryService({
      repositoryService,
      plugins: repositoryRuntimePlugins,
      pluginPolicyService,
    }),
    publishTokenService: new PublishTokenService({ state, clock, randomId, hasher }),
    publishSessionService: new PluginPublishSessionService({
      publishSessionService,
      repositoryService,
      plugins: repositoryRuntimePlugins,
      pluginPolicyService,
      repositoryActivityService,
      repositoryArtifactStore: state.repositoryArtifacts,
      repositoryObjectStore: objectStore,
      writeLock,
    }),
    repositoryActivityService,
    repositoryArtifactStore: state.repositoryArtifacts,
    repositoryArtifactIndexService,
    pluginPolicyService,
    repositorySecrets,
    repositoryObjectStore: objectStore,
    ...(downloadSigner ? { repositoryObjectDownloadSigner: downloadSigner } : {}),
    ...(uploadBroker instanceof SameOriginUploadBroker ? { localUploadBroker: uploadBroker } : {}),
    repositoryRuntimePlugins,
    repositoryWriteLock: writeLock,
    publishSessionTtlMs: publishSessionService.ttlSeconds * 1000,
  };
}

export class AxisAdminDO {
  private readonly dependencies: AppDependencies;
  private readonly app: ReturnType<typeof createApp>;

  constructor(private readonly state: DurableObjectState, private readonly env: AxisEnv) {
    this.dependencies = createDurableObjectDependencies(
      state.storage as unknown as DurableStorage,
      env,
    );
    this.app = createApp(this.dependencies);

    // Published metadata can expire, so the timer has to exist whether or not
    // anyone is publishing. Starting it here means it survives the object
    // being evicted and recreated, and recovers if an alarm was ever lost.
    void state.blockConcurrencyWhile(async () => {
      if ((await state.storage.getAlarm()) === null) {
        await state.storage.setAlarm(Date.now() + MAINTENANCE_MIN_INTERVAL_MS);
      }
    });
  }

  fetch(request: Request): Promise<Response> {
    return this.app.fetch(request);
  }

  async alarm(): Promise<void> {
    let nextRunAt = new Date(Date.now() + MAINTENANCE_MAX_INTERVAL_MS);
    try {
      const run = await runRepositoryMaintenance({
        repositories: await this.dependencies.repositoryService.list(),
        plugins: this.dependencies.repositoryRuntimePlugins,
        repositoryObjectStore: this.dependencies.repositoryObjectStore,
        writeLock: this.dependencies.repositoryWriteLock,
        clock: { now: () => new Date() },
        sessionTtlMs: this.dependencies.publishSessionTtlMs,
      });
      nextRunAt = run.nextRunAt;
      for (const failure of run.failures) {
        console.error(`Repository maintenance failed for ${failure.repositoryName}: ${failure.message}`);
      }
    } catch (error) {
      // Whatever went wrong, the alarm has to be rearmed: dropping it would
      // stop every repository's metadata being renewed, silently and forever.
      console.error(`Repository maintenance run failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    await this.state.storage.setAlarm(nextRunAt);
  }
}
