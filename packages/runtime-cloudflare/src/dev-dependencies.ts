import {
  MemoryStateStore,
  PublishSessionService,
  PublishTokenService,
  RepositoryService,
  type Clock,
  type RandomId,
  type SecretHasher,
} from "@axis-repository/core";
import MemoryUploadBroker from "./memory-upload-broker";

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

  return {
    adminToken,
    repositoryService: new RepositoryService({ state, clock, randomId }),
    publishTokenService: new PublishTokenService({ state, clock, randomId, hasher }),
    publishSessionService: new PublishSessionService({ state, uploadBroker, clock, randomId }),
  };
}
