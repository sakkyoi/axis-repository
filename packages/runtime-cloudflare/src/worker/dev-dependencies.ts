import {
  MemoryStateStore,
  AdminAuthService,
  UnauthorizedError,
  PluginPolicyService,
  RepositoryActivityService,
  PublishSessionService,
  PublishTokenService,
  RepositoryService,
  type Clock,
  type RandomId,
  type RepositoryArtifactStore,
  type RepositoryObjectStore,
  type PasswordHasher,
  type SecretHasher,
} from "@axis-repository/core";
import type { AdminUiRuntimeConfig } from "../admin-ui-assets";
import { RepositoryRuntimePluginRegistry } from "../plugins/repository-runtime-plugin-registry";
import { RepositoryWriteLock } from "./repository-write-lock";
import { createDefaultArtifactPlugins } from "../plugins/default-plugins";
import SameOriginUploadBroker from "../uploads/same-origin-upload-broker";
import { MemoryRepositoryObjectStore } from "../storage/repository-object-store";
import { PluginPublishSessionService, PluginRepositoryArtifactIndexService, PluginRepositoryService } from "./runtime-services";
import { SecretEncryption } from "../storage/secret-encryption";
import { RepositorySecretService } from "../storage/repository-secret-service";
import type { RepositoryObjectDownloadSigner } from "../storage/object-download-url";

export interface AppDependencies {
  adminAuthService: AdminAuthService;
  adminUiRuntimeConfig: AdminUiRuntimeConfig;
  /**
   * Origin repository objects are served from, when that is not the origin the
   * admin UI and API answer on. Unset means one origin serves everything.
   */
  artifactOrigin?: string;
  repositoryService: PluginRepositoryService;
  publishTokenService: PublishTokenService;
  publishSessionService: PluginPublishSessionService;
  repositoryActivityService: RepositoryActivityService;
  repositoryArtifactStore: RepositoryArtifactStore;
  repositoryArtifactIndexService: PluginRepositoryArtifactIndexService;
  pluginPolicyService: PluginPolicyService;
  repositorySecrets: RepositorySecretService;
  repositoryObjectStore: RepositoryObjectStore;
  /**
   * Signs URLs clients fetch stored objects from directly. Unset where there
   * is nothing to sign against — a local bucket or an in-memory one — and the
   * Worker serves the bytes itself.
   */
  repositoryObjectDownloadSigner?: RepositoryObjectDownloadSigner;
  localUploadBroker?: SameOriginUploadBroker;
  repositoryRuntimePlugins: RepositoryRuntimePluginRegistry;
  repositoryWriteLock: RepositoryWriteLock;
  /** How long a publish session lives; what outlives one is nobody's. */
  publishSessionTtlMs: number;
}

export interface DevDependencyHarness {
  dependencies: AppDependencies;
  repositoryObjectStore: MemoryRepositoryObjectStore;
}

export function createDevDependencies(
  signingKeyEncryptionSecret = "dev-signing-key-encryption-secret",
  adminUiRuntimeConfig: AdminUiRuntimeConfig = {},
  adminUsername = "admin",
  adminPassword = "admin-local-password",
): AppDependencies {
  return createDevDependencyHarness(signingKeyEncryptionSecret, adminUiRuntimeConfig, {}, adminUsername, adminPassword).dependencies;
}

export function createDevDependencyHarness(
  signingKeyEncryptionSecretOrLegacyAdminToken = "dev-signing-key-encryption-secret",
  adminUiRuntimeConfigOrSigningKeySecret: AdminUiRuntimeConfig | string = {},
  legacyAdminUiRuntimeConfig: AdminUiRuntimeConfig = {},
  adminUsername = "admin",
  adminPassword = "admin-local-password",
): DevDependencyHarness {
  const signingKeyEncryptionSecret = typeof adminUiRuntimeConfigOrSigningKeySecret === "string"
    ? adminUiRuntimeConfigOrSigningKeySecret
    : signingKeyEncryptionSecretOrLegacyAdminToken;
  const adminUiRuntimeConfig = typeof adminUiRuntimeConfigOrSigningKeySecret === "string"
    ? legacyAdminUiRuntimeConfig
    : adminUiRuntimeConfigOrSigningKeySecret;
  const state = new MemoryStateStore();
  const clock: Clock = { now: () => new Date() };
  const randomId: RandomId = {
    create(prefix: string): string {
      return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
    },
  };
  const hasher: SecretHasher = {
    hash: async (secret: string): Promise<string> => `dev:${secret}`,
    verify: async (secret: string, hash: string): Promise<boolean> => hash === `dev:${secret}`,
  };
  // Deliberately not a KDF: the dev harness backs the test suite, where a real
  // work factor would cost seconds across hundreds of logins.
  const passwordHasher: PasswordHasher = {
    hash: async (password: string): Promise<string> => `dev:${password}`,
    verify: async (password: string, hash: string): Promise<boolean> => hash === `dev:${password}`,
    needsRehash: (): boolean => false,
  };
  let refreshSequence = 0;
  const adminAuthService = new AdminAuthService({
    state,
    clock,
    randomId: {
      create(prefix: string): string {
        if (prefix === "admin_user") return "admin_user_dev";
        if (prefix === "admin_session") return "admin_session_dev";
        if (prefix === "refresh") return `refresh_dev_${++refreshSequence}`;
        return randomId.create(prefix);
      },
    },
    hasher,
    passwordHasher,
    bootstrapOwner: {
      username: adminUsername,
      password: adminPassword,
    },
    accessTokens: {
      create: async () => "dev-admin-token",
      verify: async (token) => {
        if (token !== "dev-admin-token") {
          throw new UnauthorizedError();
        }
        return {
          type: "admin",
          subject: "admin_user_dev",
          username: adminUsername,
          role: "owner",
          scopes: ["admin:*"],
          sessionId: "admin_session_dev",
        };
      },
    },
  });
  // verifyAccessToken requires a live session and an enabled user, and the fake
  // codec above hands out a principal without anyone signing in. Seed both so
  // the harness models an owner who has already signed in. MemoryStateStore
  // applies writes before its promise settles, so these are in place for the
  // first request.
  void state.adminUsers.save({
    id: "admin_user_dev",
    username: adminUsername,
    displayName: adminUsername,
    passwordHash: `dev:${adminPassword}`,
    role: "owner",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  void state.adminRefreshSessions.save({
    id: "admin_session_dev",
    subject: "admin_user_dev",
    username: adminUsername,
    role: "owner",
    tokenHash: "dev:unused",
    scopes: ["admin:*"],
    createdAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
  });

  const objectStore = new MemoryRepositoryObjectStore();
  const uploadBroker = new SameOriginUploadBroker(objectStore);
  const repositorySecrets = new RepositorySecretService({
    state,
    clock,
    randomId,
    encryption: new SecretEncryption(signingKeyEncryptionSecret),
  });
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

  return {
    dependencies: {
      adminAuthService,
      adminUiRuntimeConfig,
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
        writeLock,
      }),
      repositoryActivityService,
      repositoryArtifactStore: state.repositoryArtifacts,
      pluginPolicyService,
      repositorySecrets,
      repositoryObjectStore: objectStore,
      repositoryArtifactIndexService,
      localUploadBroker: uploadBroker,
      repositoryRuntimePlugins,
      repositoryWriteLock: writeLock,
      publishSessionTtlMs: publishSessionService.ttlSeconds * 1000,
    },
    repositoryObjectStore: objectStore,
  };
}
