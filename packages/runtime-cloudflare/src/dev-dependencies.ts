import {
  MemoryStateStore,
  PublishSessionService,
  PublishTokenService,
  RepositoryService,
  type Clock,
  type RandomId,
  type SecretHasher,
} from "@axis-repository/core";
import { ArtifactPublisherRegistry } from "./artifact-publisher-registry";
import { GenericManifestPublisher } from "./generic-manifest-publisher";
import MemoryUploadBroker from "./memory-upload-broker";
import { MemoryRepositoryObjectStore } from "./repository-object-store";

export interface AppDependencies {
  adminToken: string;
  repositoryService: RepositoryService;
  publishTokenService: PublishTokenService;
  publishSessionService: PublishSessionService;
}

export function createDevDependencies(adminToken = "dev-admin-token"): AppDependencies {
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
  const genericManifestPublisher = new GenericManifestPublisher({ objectStore });
  const artifactPublisher = new ArtifactPublisherRegistry();
  artifactPublisher.register({
    ecosystem: "apt",
    name: "generic-manifest",
    version: "0.0.0",
    capabilities: ["generic-manifest"],
    publisher: genericManifestPublisher,
  });

  return {
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
  };
}
