import {
  MemoryStateStore,
  PublishSessionService,
  PublishTokenService,
  RepositoryService,
  type Clock,
  type RandomId,
  type RepositoryObjectStore,
  type SecretHasher,
} from "@axis-repository/core";
import { AptPublisher } from "./apt-publisher";
import { ArtifactPublisherRegistry } from "./artifact-publisher-registry";
import MemoryUploadBroker from "./memory-upload-broker";
import { OpenPgpSigner } from "./openpgp-signer";
import { MemoryRepositoryObjectStore } from "./repository-object-store";
import { SecretEncryption } from "./secret-encryption";
import { SigningKeyService } from "./signing-key-service";

export interface AppDependencies {
  adminToken: string;
  repositoryService: RepositoryService;
  publishTokenService: PublishTokenService;
  publishSessionService: PublishSessionService;
  signingKeyService: SigningKeyService;
  repositoryObjectStore: RepositoryObjectStore;
}

export interface DevDependencyHarness {
  dependencies: AppDependencies;
  repositoryObjectStore: MemoryRepositoryObjectStore;
}

export function createDevDependencies(
  adminToken = "dev-admin-token",
  signingKeyEncryptionSecret = "dev-signing-key-encryption-secret",
): AppDependencies {
  return createDevDependencyHarness(adminToken, signingKeyEncryptionSecret).dependencies;
}

export function createDevDependencyHarness(
  adminToken = "dev-admin-token",
  signingKeyEncryptionSecret = "dev-signing-key-encryption-secret",
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
  const aptPublisher = new AptPublisher({
    objectStore,
    signingKeyService,
    signer: new OpenPgpSigner(),
  });
  const artifactPublisher = new ArtifactPublisherRegistry();
  artifactPublisher.register({
    ecosystem: "apt",
    name: "apt-signed",
    version: "0.1.0",
    capabilities: ["apt", "signed-release", "pool-copy"],
    publisher: aptPublisher,
  });

  return {
    dependencies: {
      adminToken,
      repositoryService: new RepositoryService({ state, clock, randomId }),
      publishTokenService: new PublishTokenService({ state, clock, randomId, hasher }),
      publishSessionService: new PublishSessionService({
        state,
        uploadBroker,
        artifactPublisher,
        clock,
        randomId,
      }),
      signingKeyService,
      repositoryObjectStore: objectStore,
    },
    repositoryObjectStore: objectStore,
  };
}
