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
import type { AdminUiRuntimeConfig } from "../admin-ui-assets";
import { RepositoryRuntimePluginRegistry } from "../plugins/repository-runtime-plugin-registry";
import { createDefaultArtifactPlugins } from "../plugins/default-plugins";
import SameOriginUploadBroker from "../uploads/same-origin-upload-broker";
import { MemoryRepositoryObjectStore } from "../storage/repository-object-store";
import { PluginPublishSessionService, PluginRepositoryService } from "./runtime-services";
import { SecretEncryption } from "../storage/secret-encryption";
import { RepositorySecretService } from "../storage/repository-secret-service";

export interface AppDependencies {
  adminToken: string;
  adminUiRuntimeConfig: AdminUiRuntimeConfig;
  repositoryService: PluginRepositoryService;
  publishTokenService: PublishTokenService;
  publishSessionService: PluginPublishSessionService;
  pluginPolicyService: PluginPolicyService;
  repositorySecrets: RepositorySecretService;
  repositoryObjectStore: RepositoryObjectStore;
  localUploadBroker?: SameOriginUploadBroker;
  repositoryRuntimePlugins: RepositoryRuntimePluginRegistry;
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
  const publishSessionService = new PublishSessionService({
    state,
    uploadBroker,
    artifactPublisher: repositoryRuntimePlugins,
    clock,
    randomId,
  });

  return {
    dependencies: {
      adminToken,
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
      }),
      pluginPolicyService,
      repositorySecrets,
      repositoryObjectStore: objectStore,
      localUploadBroker: uploadBroker,
      repositoryRuntimePlugins,
    },
    repositoryObjectStore: objectStore,
  };
}
