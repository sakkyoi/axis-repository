import {
  MemoryStateStore,
  PublishSessionService,
  PublishTokenService,
  RepositoryService,
  type Clock,
  type RandomId,
  type SecretHasher,
  type UploadBroker,
} from "@axis-repository/core";

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
  const uploadBroker: UploadBroker = {
    createUploadTarget: async ({ sessionId, uploadId, artifact, expiresAt }) => ({
      uploadId,
      filename: artifact.filename,
      objectKey: `_staging/uploads/${sessionId}/${uploadId}/${artifact.filename}`,
      method: "PUT",
      url: `https://uploads.local/${sessionId}/${uploadId}`,
      headers: { "content-type": artifact.contentType },
      expiresAt: expiresAt.toISOString(),
    }),
    verifyUpload: async ({ target, expected }) => ({
      uploadId: target.uploadId,
      objectKey: target.objectKey,
      size: expected.size,
      sha256: expected.sha256,
    }),
    abortUpload: async () => {},
  };

  return {
    adminToken,
    repositoryService: new RepositoryService({ state, clock, randomId }),
    publishTokenService: new PublishTokenService({ state, clock, randomId, hasher }),
    publishSessionService: new PublishSessionService({ state, uploadBroker, clock, randomId }),
  };
}
