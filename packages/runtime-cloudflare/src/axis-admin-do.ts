import {
  PublishSessionService,
  PublishTokenService,
  RepositoryService,
  type Clock,
  type UploadBroker,
} from "@axis-repository/core";
import { createApp } from "./app";
import { WebCryptoRandomId, Sha256SecretHasher } from "./crypto";
import { DurableStateStore, type DurableStorage } from "./durable-state";
import type { AppDependencies } from "./dev-dependencies";

export interface AxisEnv {
  AXIS_ADMIN?: DurableObjectNamespace;
  ADMIN_TOKEN?: string;
  TOKEN_HASH_PEPPER?: string;
}

function createFakeUploadBroker(): UploadBroker {
  return {
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

  const state = new DurableStateStore(storage);
  const clock: Clock = { now: () => new Date() };
  const randomId = new WebCryptoRandomId();
  const hasher = new Sha256SecretHasher(env.TOKEN_HASH_PEPPER);
  const uploadBroker = createFakeUploadBroker();

  return {
    adminToken: env.ADMIN_TOKEN,
    repositoryService: new RepositoryService({ state, clock, randomId }),
    publishTokenService: new PublishTokenService({ state, clock, randomId, hasher }),
    publishSessionService: new PublishSessionService({ state, uploadBroker, clock, randomId }),
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
