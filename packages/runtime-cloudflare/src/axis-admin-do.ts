import {
  PublishSessionService,
  PublishTokenService,
  RepositoryService,
  type Clock,
} from "@axis-repository/core";
import { createApp } from "./app";
import { createAptPlugin } from "./apt-plugin";
import { AptPublisher } from "./apt-publisher";
import { ArtifactPublisherRegistry } from "./artifact-publisher-registry";
import { WebCryptoRandomId, Sha256SecretHasher } from "./crypto";
import { DurableStateStore, type DurableStorage } from "./durable-state";
import type { AppDependencies } from "./dev-dependencies";
import { MemoryUploadBroker } from "./memory-upload-broker";
import { OpenPgpSigner } from "./openpgp-signer";
import { R2PresignedUploadBroker } from "./r2-upload-broker";
import { MemoryRepositoryObjectStore, R2RepositoryObjectStore } from "./repository-object-store";
import { PluginPublishSessionService, PluginRepositoryService } from "./runtime-services";
import { SecretEncryption } from "./secret-encryption";
import { SigningKeyService } from "./signing-key-service";

export interface AxisEnv {
  AXIS_ADMIN?: DurableObjectNamespace;
  AXIS_OBJECTS?: R2Bucket;
  ADMIN_TOKEN?: string;
  TOKEN_HASH_PEPPER?: string;
  SIGNING_KEY_ENCRYPTION_SECRET?: string;
  R2_ACCOUNT_ID?: string;
  R2_BUCKET_NAME?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  UPLOAD_URL_TTL_SECONDS?: string;
  UPLOAD_BACKEND?: string;
  ADMIN_UI_API_BASE_URL?: string;
}

type UploadBackend = "r2" | "memory";

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
  throw new Error("UPLOAD_BACKEND must be one of: r2, memory");
}

function requiredR2Bucket(value: R2Bucket | undefined): R2Bucket {
  if (!value) {
    throw new Error("AXIS_OBJECTS is required for AxisAdminDO");
  }
  return value;
}

export function createDurableObjectDependencies(
  storage: DurableStorage,
  env: AxisEnv,
): AppDependencies {
  if (!env.ADMIN_TOKEN) {
    throw new Error("ADMIN_TOKEN is required for AxisAdminDO");
  }
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
  const encryption = new SecretEncryption(env.SIGNING_KEY_ENCRYPTION_SECRET);
  const signingKeyService = new SigningKeyService({
    state,
    clock,
    randomId,
    encryption,
  });
  const uploadUrlTtlSeconds = optionalPositiveInteger(env.UPLOAD_URL_TTL_SECONDS, "UPLOAD_URL_TTL_SECONDS");
  const uploadBackend = parseUploadBackend(env.UPLOAD_BACKEND);
  const uploadBroker = uploadBackend === "memory"
    ? new MemoryUploadBroker()
    : new R2PresignedUploadBroker({
      bucket: requiredR2Bucket(env.AXIS_OBJECTS),
      accountId: requiredEnv(env.R2_ACCOUNT_ID, "R2_ACCOUNT_ID"),
      bucketName: requiredEnv(env.R2_BUCKET_NAME, "R2_BUCKET_NAME"),
      accessKeyId: requiredEnv(env.R2_ACCESS_KEY_ID, "R2_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnv(env.R2_SECRET_ACCESS_KEY, "R2_SECRET_ACCESS_KEY"),
      ...(uploadUrlTtlSeconds === undefined ? {} : { uploadUrlTtlSeconds }),
    });
  const objectStore = uploadBackend === "memory"
    ? new MemoryRepositoryObjectStore()
    : new R2RepositoryObjectStore(requiredR2Bucket(env.AXIS_OBJECTS));
  const aptPublisher = new AptPublisher({
    objectStore,
    signingKeyService,
    signer: new OpenPgpSigner(),
  });
  const artifactPublisher = new ArtifactPublisherRegistry();
  artifactPublisher.register(createAptPlugin({ publisher: aptPublisher }));
  const repositoryService = new RepositoryService({ state, clock, randomId });
  const publishSessionService = new PublishSessionService({
    state,
    uploadBroker,
    artifactPublisher,
    clock,
    randomId,
  });

  return {
    adminToken: env.ADMIN_TOKEN,
    adminUiRuntimeConfig: { apiBaseUrl: env.ADMIN_UI_API_BASE_URL ?? "" },
    repositoryService: new PluginRepositoryService({
      repositoryService,
      plugins: artifactPublisher,
    }),
    publishTokenService: new PublishTokenService({ state, clock, randomId, hasher }),
    publishSessionService: new PluginPublishSessionService({
      publishSessionService,
      repositoryService,
      plugins: artifactPublisher,
    }),
    signingKeyService,
    repositoryObjectStore: objectStore,
    artifactPublisherRegistry: artifactPublisher,
  };
}

export class AxisAdminDO {
  private readonly app: ReturnType<typeof createApp>;

  constructor(private readonly state: DurableObjectState, private readonly env: AxisEnv) {
    this.app = createApp(
      createDurableObjectDependencies(
        state.storage as unknown as DurableStorage,
        env,
      ),
    );
  }

  fetch(request: Request): Promise<Response> {
    return this.app.fetch(request);
  }
}
