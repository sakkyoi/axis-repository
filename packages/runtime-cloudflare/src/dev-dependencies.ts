import {
  MemoryStateStore,
  PluginPolicyService,
  PublishSessionService,
  PublishTokenService,
  RepositoryService,
  type Clock,
  type RandomId,
  type RepositoryObjectStore,
  type SecretHasher,
} from "@axis-repository/core";
import type { AdminUiRuntimeConfig } from "./admin-ui-assets";
import { ArtifactPublisherRegistry } from "./artifact-publisher-registry";
import { createDefaultArtifactPlugins } from "./default-plugins";
import MemoryUploadBroker from "./memory-upload-broker";
import { MemoryRepositoryObjectStore } from "./repository-object-store";
import { PluginPublishSessionService, PluginRepositoryService } from "./runtime-services";
import { SecretEncryption } from "./secret-encryption";
import { SigningKeyService } from "./signing-key-service";

export interface AppDependencies {
  adminToken: string;
  adminUiRuntimeConfig: AdminUiRuntimeConfig;
  repositoryService: PluginRepositoryService;
  publishTokenService: PublishTokenService;
  publishSessionService: PluginPublishSessionService;
  pluginPolicyService: PluginPolicyService;
  signingKeyService: SigningKeyService;
  repositoryObjectStore: RepositoryObjectStore;
  artifactPublisherRegistry: ArtifactPublisherRegistry;
}

export interface DevDependencyHarness {
  dependencies: AppDependencies;
  repositoryObjectStore: MemoryRepositoryObjectStore;
}

export function createDevDependencies(
  adminToken = "dev-admin-token",
  signingKeyEncryptionSecret = "dev-signing-key-encryption-secret",
  adminUiRuntimeConfig: AdminUiRuntimeConfig = {},
): AppDependencies {
  return createDevDependencyHarness(adminToken, signingKeyEncryptionSecret, adminUiRuntimeConfig).dependencies;
}

export function createDevDependencyHarness(
  adminToken = "dev-admin-token",
  signingKeyEncryptionSecret = "dev-signing-key-encryption-secret",
  adminUiRuntimeConfig: AdminUiRuntimeConfig = {},
): DevDependencyHarness {
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
  const uploadBroker = new MemoryUploadBroker();
  const objectStore = new MemoryRepositoryObjectStore();
  const signingKeyService = new SigningKeyService({
    state,
    clock,
    randomId,
    encryption: new SecretEncryption(signingKeyEncryptionSecret),
  });
  const artifactPublisher = createDefaultArtifactPlugins({ objectStore, signingKeyService });
  const repositoryService = new RepositoryService({ state, clock, randomId });
  const pluginPolicyService = new PluginPolicyService({ state });
  const publishSessionService = new PublishSessionService({
    state,
    uploadBroker,
    artifactPublisher,
    clock,
    randomId,
  });

  return {
    dependencies: {
      adminToken,
      adminUiRuntimeConfig,
      repositoryService: new PluginRepositoryService({
        repositoryService,
        plugins: artifactPublisher,
        pluginPolicyService,
      }),
      publishTokenService: new PublishTokenService({ state, clock, randomId, hasher }),
      publishSessionService: new PluginPublishSessionService({
        publishSessionService,
        repositoryService,
        plugins: artifactPublisher,
        pluginPolicyService,
      }),
      pluginPolicyService,
      signingKeyService,
      repositoryObjectStore: objectStore,
      artifactPublisherRegistry: artifactPublisher,
    },
    repositoryObjectStore: objectStore,
  };
}
