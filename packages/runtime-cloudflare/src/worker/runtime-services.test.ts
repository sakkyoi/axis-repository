import {
  MemoryStateStore,
  PluginPolicyService,
  RepositoryActivityService,
  PublishSessionService,
  type RepositoryArtifactRecord,
  type RepositoryObjectStore,
  RepositoryService,
  ValidationError,
  type ArtifactPublisher,
  type Clock,
  type PublishArtifactRequest,
  type RandomId,
  type TokenPrincipal,
  type UploadBroker,
} from "@axis-repository/core";
import { describe, expect, it } from "vitest";
import { RepositoryRuntimePluginRegistry } from "../plugins/repository-runtime-plugin-registry";
import { PluginPublishSessionService, PluginRepositoryArtifactIndexService } from "./runtime-services";

const clock: Clock = {
  now: () => new Date("2026-07-24T00:00:00.000Z"),
};

const randomId: RandomId = {
  create: (prefix: string) => `${prefix}_fixed`,
};

const artifact: PublishArtifactRequest = {
  filename: "myapp_1.2.3_amd64.deb",
  size: 1234,
  sha256: "a".repeat(64),
  contentType: "application/vnd.debian.binary-package",
  metadata: {},
};

const principal: TokenPrincipal = {
  tokenId: "tok_1",
  name: "ci",
  permissions: ["publish"],
  repositories: ["debian-internal"],
  ecosystemScopes: {},
  signingKeyIds: [],
};

const uploadBroker: UploadBroker = {
  createUploadTarget: async ({ sessionId, uploadId, artifact, expiresAt }) => ({
    uploadId,
    filename: artifact.filename,
    objectKey: `_staging/uploads/${sessionId}/${uploadId}/${artifact.filename}`,
    method: "PUT",
    url: `https://uploads.example/${uploadId}`,
    headers: {},
    expiresAt: expiresAt.toISOString(),
  }),
  verifyUpload: async ({ target, expected }) => ({
    uploadId: target.uploadId,
    objectKey: target.objectKey,
    size: expected.size,
    sha256: expected.sha256,
  }),
};

function memoryObjectStore(existingKeys: string[] = []): RepositoryObjectStore {
  const keys = new Set(existingKeys);
  return {
    putJson: async () => {},
    putText: async () => {},
    putBytes: async () => {},
    copyObject: async () => {},
    listObjects: async () => ({ prefix: "", directories: [], objects: [], truncated: false }),
    headObject: async (key) => keys.has(key) ? {} : null,
    getObject: async (key) => keys.has(key) ? { body: new Uint8Array() } : null,
    deleteObject: async (key) => keys.delete(key),
  };
}

describe("PluginPublishSessionService", () => {
  it("authorizes finalize through the repository runtime plugin before publishing", async () => {
    const state = new MemoryStateStore();
    const repositoryService = new RepositoryService({ state, clock, randomId });
    await repositoryService.create({
      name: "debian-internal",
      ecosystem: "apt",
      config: {},
    });
    const publishCalls: unknown[] = [];
    const publisher: ArtifactPublisher = {
      publish: async (input) => {
        publishCalls.push(input);
        return {
          publishedAt: "2026-07-24T00:00:00.000Z",
          objects: [],
        };
      },
    };
    const plugins = new RepositoryRuntimePluginRegistry();
    plugins.register({
      ecosystem: "apt",
      name: "apt-test",
      version: "0.0.0",
      capabilities: ["publish"],
      canServeRepositoryPath: () => false,
      validateRepositoryConfig: () => {},
      publish: {
        validateArtifacts: () => {},
        authorize: () => {
          throw new ValidationError("plugin denied publish");
        },
        finalize: (input) => publisher.publish(input),
      },
    });
    const corePublishSessionService = new PublishSessionService({
      state,
      uploadBroker,
      artifactPublisher: plugins,
      clock,
      randomId,
    });
    const service = new PluginPublishSessionService({
      publishSessionService: corePublishSessionService,
      repositoryService,
      plugins,
      pluginPolicyService: new PluginPolicyService({ state }),
      repositoryArtifactStore: state.repositoryArtifacts,
    });
    const session = await corePublishSessionService.create({
      repositoryName: "debian-internal",
      ecosystem: "apt",
      principal,
      artifacts: [artifact],
    });
    await corePublishSessionService.verifyUpload({
      sessionId: session.id,
      uploadId: session.uploads[0]!.uploadId,
      principal,
    });

    await expect(service.finalize({ sessionId: session.id, principal })).rejects.toThrow(
      new ValidationError("plugin denied publish"),
    );

    expect(publishCalls).toHaveLength(0);
    await expect(state.publishSessions.get(session.id)).resolves.toMatchObject({
      status: "ready",
    });
  });

  it("authorizes admin finalize with repository-derived signing key scopes", async () => {
    const state = new MemoryStateStore();
    const repositoryService = new RepositoryService({ state, clock, randomId });
    await repositoryService.create({
      name: "debian-internal",
      ecosystem: "apt",
      config: {
        apt: {
          signingKeyId: "legacy_config_key",
        },
      },
    });
    let authorizeSigningKeyIds: string[] | undefined;
    const plugins = new RepositoryRuntimePluginRegistry();
    plugins.register({
      ecosystem: "apt",
      name: "apt-test",
      version: "0.0.0",
      capabilities: ["publish"],
      canServeRepositoryPath: () => false,
      validateRepositoryConfig: () => {},
      publish: {
        validateArtifacts: () => {},
        derivePrincipalScope: () => ({
          signingKeyIds: ["plugin_key"],
        }),
        authorize: ({ principal }) => {
          authorizeSigningKeyIds = principal.signingKeyIds;
        },
        finalize: async () => ({
          publishedAt: "2026-07-24T00:00:00.000Z",
          objects: [],
        }),
      },
    });
    const corePublishSessionService = new PublishSessionService({
      state,
      uploadBroker,
      artifactPublisher: plugins,
      clock,
      randomId,
    });
    const service = new PluginPublishSessionService({
      publishSessionService: corePublishSessionService,
      repositoryService,
      plugins,
      pluginPolicyService: new PluginPolicyService({ state }),
      repositoryArtifactStore: state.repositoryArtifacts,
    });
    const session = await corePublishSessionService.create({
      repositoryName: "debian-internal",
      ecosystem: "apt",
      principal,
      artifacts: [artifact],
    });
    await corePublishSessionService.verifyUpload({
      sessionId: session.id,
      uploadId: session.uploads[0]!.uploadId,
      principal,
    });

    await service.finalizeAsAdmin({ sessionId: session.id });

    expect(authorizeSigningKeyIds).toEqual(["plugin_key"]);
  });

  it("creates admin publish sessions with plugin-derived principal scopes", async () => {
    const state = new MemoryStateStore();
    const repositoryService = new RepositoryService({ state, clock, randomId });
    await repositoryService.create({
      name: "debian-internal",
      ecosystem: "apt",
      config: {
        apt: {
          signingKeyId: "legacy_config_key",
        },
      },
    });
    const plugins = new RepositoryRuntimePluginRegistry();
    plugins.register({
      ecosystem: "apt",
      name: "apt-test",
      version: "0.0.0",
      capabilities: ["publish"],
      canServeRepositoryPath: () => false,
      validateRepositoryConfig: () => {},
      publish: {
        validateArtifacts: () => {},
        derivePrincipalScope: () => ({
          ecosystemScopes: { apt: { component: "main" } },
          signingKeyIds: ["plugin_key"],
        }),
        authorize: () => {},
        finalize: async () => ({
          publishedAt: "2026-07-24T00:00:00.000Z",
          objects: [],
        }),
      },
    });
    const service = new PluginPublishSessionService({
      publishSessionService: new PublishSessionService({
        state,
        uploadBroker,
        artifactPublisher: plugins,
        clock,
        randomId,
      }),
      repositoryService,
      plugins,
      pluginPolicyService: new PluginPolicyService({ state }),
    });

    const session = await service.createAsAdmin({
      repositoryName: "debian-internal",
      ecosystem: "apt",
      artifacts: [artifact],
    });

    expect(session.requestedBy.signingKeyIds).toEqual(["plugin_key"]);
    expect(session.requestedBy.ecosystemScopes).toEqual({ apt: { component: "main" } });
  });

  it("records object update activity for published objects with previous metadata", async () => {
    const state = new MemoryStateStore();
    const repositoryService = new RepositoryService({ state, clock, randomId });
    await repositoryService.create({
      name: "debian-internal",
      ecosystem: "apt",
      config: {},
    });
    const plugins = new RepositoryRuntimePluginRegistry();
    plugins.register({
      ecosystem: "apt",
      name: "apt-test",
      version: "0.0.0",
      capabilities: ["publish"],
      canServeRepositoryPath: () => false,
      validateRepositoryConfig: () => {},
      publish: {
        validateArtifacts: () => {},
        authorize: () => {},
        finalize: async () => ({
          publishedAt: "2026-07-24T00:00:00.000Z",
          objects: [{
            key: "repositories/debian-internal/dists/noble/Release",
            contentType: "text/plain; charset=utf-8",
            previous: {
              contentType: "text/plain",
              size: 7,
            },
          }],
        }),
      },
    });
    const corePublishSessionService = new PublishSessionService({
      state,
      uploadBroker,
      artifactPublisher: plugins,
      clock,
      randomId,
    });
    const service = new PluginPublishSessionService({
      publishSessionService: corePublishSessionService,
      repositoryService,
      plugins,
      pluginPolicyService: new PluginPolicyService({ state }),
      repositoryActivityService: new RepositoryActivityService({ state, clock, randomId }),
    });
    const session = await corePublishSessionService.create({
      repositoryName: "debian-internal",
      ecosystem: "apt",
      principal,
      artifacts: [artifact],
    });
    await corePublishSessionService.verifyUpload({
      sessionId: session.id,
      uploadId: session.uploads[0]!.uploadId,
      principal,
    });

    await service.finalize({ sessionId: session.id, principal });

    await expect(state.repositoryActivities.listByRepository("debian-internal")).resolves.toMatchObject([{
      type: "object.update",
      summary: "Updated dists/noble/Release",
      metadata: {
        path: "dists/noble/Release",
        objectKey: "repositories/debian-internal/dists/noble/Release",
        previousContentType: "text/plain",
        previousSize: 7,
        contentType: "text/plain; charset=utf-8",
      },
    }]);
  });

  it("indexes plugin-described artifacts after finalize", async () => {
    const state = new MemoryStateStore();
    const repositoryService = new RepositoryService({ state, clock, randomId });
    await repositoryService.create({
      name: "debian-internal",
      ecosystem: "apt",
      config: {},
    });
    const indexedArtifact: RepositoryArtifactRecord = {
      id: "artifact_myapp",
      repositoryName: "debian-internal",
      ecosystem: "apt",
      identity: "apt:myapp:1.2.3:amd64",
      name: "myapp",
      version: "1.2.3",
      summary: "myapp 1.2.3 amd64",
      primaryObjectKey: "repositories/debian-internal/pool/main/m/myapp/myapp_1.2.3_amd64.deb",
      objectKeys: ["repositories/debian-internal/pool/main/m/myapp/myapp_1.2.3_amd64.deb"],
      metadata: { architecture: "amd64" },
      publishedAt: "2026-07-24T00:00:00.000Z",
      updatedAt: "2026-07-24T00:00:00.000Z",
      publishSessionId: "pub_fixed",
    };
    const plugins = new RepositoryRuntimePluginRegistry();
    plugins.register({
      ecosystem: "apt",
      name: "apt-test",
      version: "0.0.0",
      capabilities: ["publish"],
      canServeRepositoryPath: () => false,
      validateRepositoryConfig: () => {},
      publish: {
        validateArtifacts: () => {},
        authorize: () => {},
        finalize: async () => ({
          publishedAt: "2026-07-24T00:00:00.000Z",
          objects: [{
            key: indexedArtifact.primaryObjectKey!,
            contentType: "application/vnd.debian.binary-package",
          }],
        }),
        describeArtifacts: () => [indexedArtifact],
      },
    });
    const corePublishSessionService = new PublishSessionService({
      state,
      uploadBroker,
      artifactPublisher: plugins,
      clock,
      randomId,
    });
    const service = new PluginPublishSessionService({
      publishSessionService: corePublishSessionService,
      repositoryService,
      plugins,
      pluginPolicyService: new PluginPolicyService({ state }),
      repositoryArtifactStore: state.repositoryArtifacts,
    });
    const session = await corePublishSessionService.create({
      repositoryName: "debian-internal",
      ecosystem: "apt",
      principal,
      artifacts: [artifact],
    });
    await corePublishSessionService.verifyUpload({
      sessionId: session.id,
      uploadId: session.uploads[0]!.uploadId,
      principal,
    });

    await service.finalize({ sessionId: session.id, principal });

    await expect(state.repositoryArtifacts.listByRepository("debian-internal")).resolves.toEqual([indexedArtifact]);
  });
});

describe("PluginRepositoryArtifactIndexService", () => {
  const indexedArtifact: RepositoryArtifactRecord = {
    id: "artifact_myapp",
    repositoryName: "debian-internal",
    ecosystem: "apt",
    identity: "apt:myapp:1.2.3:amd64",
    name: "myapp",
    version: "1.2.3",
    summary: "myapp 1.2.3 amd64",
    primaryObjectKey: "repositories/debian-internal/pool/main/m/myapp/myapp_1.2.3_amd64.deb",
    objectKeys: [
      "repositories/debian-internal/pool/main/m/myapp/myapp_1.2.3_amd64.deb",
      "repositories/debian-internal/pool/main/missing/missing_1.0.0_amd64.deb",
      "repositories/other/pool/main/other/other_1.0.0_amd64.deb",
    ],
    metadata: { architecture: "amd64" },
    publishedAt: "2026-07-24T00:00:00.000Z",
    updatedAt: "2026-07-24T00:00:00.000Z",
  };

  it("deletes artifact objects with explicit deleted, missing, and skipped results", async () => {
    const state = new MemoryStateStore();
    const repositoryService = new RepositoryService({ state, clock, randomId });
    await repositoryService.create({
      name: "debian-internal",
      ecosystem: "apt",
      config: {},
    });
    await state.repositoryArtifacts.upsert(indexedArtifact);
    const plugins = new RepositoryRuntimePluginRegistry();
    plugins.register({
      ecosystem: "apt",
      name: "apt-test",
      version: "0.0.0",
      capabilities: ["publish"],
      canServeRepositoryPath: () => false,
      validateRepositoryConfig: () => {},
      publish: {
        validateArtifacts: () => {},
        authorize: () => {},
        finalize: async () => ({ publishedAt: "2026-07-24T00:00:00.000Z", objects: [] }),
      },
      artifacts: {
        rebuildIndex: async () => [],
      },
    });
    const objectStore = memoryObjectStore([indexedArtifact.objectKeys[0]!]);
    const service = new PluginRepositoryArtifactIndexService({
      repositoryService,
      plugins,
      repositoryObjectStore: objectStore,
      repositoryArtifactStore: state.repositoryArtifacts,
      clock,
    });

    await expect(service.deleteArtifact({
      repositoryName: "debian-internal",
      artifactId: "artifact_myapp",
    })).resolves.toMatchObject({
      artifact: indexedArtifact,
      deletedObjectKeys: [indexedArtifact.objectKeys[0]],
      missingObjectKeys: [indexedArtifact.objectKeys[1]],
      skippedObjectKeys: [indexedArtifact.objectKeys[2]],
      failedObjectKeys: [],
      artifacts: [],
    });
    await expect(objectStore.headObject(indexedArtifact.objectKeys[0]!)).resolves.toBeNull();
    await expect(state.repositoryArtifacts.listByRepository("debian-internal")).resolves.toEqual([]);
  });

  it("lets repository plugins override artifact delete behavior", async () => {
    const state = new MemoryStateStore();
    const repositoryService = new RepositoryService({ state, clock, randomId });
    await repositoryService.create({
      name: "debian-internal",
      ecosystem: "apt",
      config: {},
    });
    await state.repositoryArtifacts.upsert(indexedArtifact);
    const pluginCalls: string[] = [];
    const plugins = new RepositoryRuntimePluginRegistry();
    plugins.register({
      ecosystem: "apt",
      name: "apt-test",
      version: "0.0.0",
      capabilities: ["publish"],
      canServeRepositoryPath: () => false,
      validateRepositoryConfig: () => {},
      publish: {
        validateArtifacts: () => {},
        authorize: () => {},
        finalize: async () => ({ publishedAt: "2026-07-24T00:00:00.000Z", objects: [] }),
      },
      artifacts: {
        rebuildIndex: async () => [],
        deleteArtifact: async ({ artifact }) => {
          pluginCalls.push(artifact.id);
          return {
            deletedObjectKeys: [],
            missingObjectKeys: [],
            skippedObjectKeys: [...artifact.objectKeys],
            failedObjectKeys: [],
          };
        },
      },
    });
    const objectStore = memoryObjectStore([indexedArtifact.objectKeys[0]!]);
    const service = new PluginRepositoryArtifactIndexService({
      repositoryService,
      plugins,
      repositoryObjectStore: objectStore,
      repositoryArtifactStore: state.repositoryArtifacts,
      clock,
    });

    await expect(service.deleteArtifact({
      repositoryName: "debian-internal",
      artifactId: "artifact_myapp",
    })).resolves.toMatchObject({
      deletedObjectKeys: [],
      skippedObjectKeys: indexedArtifact.objectKeys,
      failedObjectKeys: [],
    });
    expect(pluginCalls).toEqual(["artifact_myapp"]);
    await expect(objectStore.headObject(indexedArtifact.objectKeys[0]!)).resolves.toEqual({});
  });
});
