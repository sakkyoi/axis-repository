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
import {
  PluginPublishSessionService,
  PluginRepositoryArtifactIndexService,
  PluginRepositoryGroupDependencyService,
  PluginRepositoryService,
} from "./runtime-services";
import { RepositoryWriteLock } from "./repository-write-lock";

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
    createPartWriter: async () => ({
      write: async () => {},
      complete: async () => ({ size: 0 }),
      abort: async () => {},
    }),
    copyObject: async () => {},
    listObjects: async () => ({ prefix: "", directories: [], objects: [], truncated: false }),
    headObject: async (key) => keys.has(key) ? {} : null,
    getObject: async (key) => keys.has(key) ? { body: new Uint8Array() } : null,
    deleteObject: async (key) => keys.delete(key),
    deleteObjects: async (removing) => {
      for (const key of removing) {
        keys.delete(key);
      }
    },
  };
}

describe("PluginRepositoryService", () => {
  it("creates proxy repositories through the matching kind plugin", async () => {
    const state = new MemoryStateStore();
    const repositoryService = new RepositoryService({ state, clock, randomId });
    const plugins = new RepositoryRuntimePluginRegistry();
    plugins.register({
      kind: "hosted",
      repositoryKinds: [{ kind: "hosted", experimental: false }],
      ecosystem: "demo",
      name: "demo-hosted",
      version: "0.0.0",
      capabilities: ["hosted"],
      canServeRepositoryPath: () => false,
      validateRepositoryConfig: () => {
        throw new ValidationError("hosted config should not validate proxy repositories");
      },
      publish: {
        validateArtifacts: () => {},
        authorize: () => {},
        finalize: async () => ({ publishedAt: clock.now().toISOString(), objects: [] }),
      },
    });
    plugins.register({
      kind: "proxy",
      repositoryKinds: [{ kind: "proxy", experimental: true }],
      ecosystem: "demo",
      name: "demo-proxy",
      version: "0.0.0",
      capabilities: ["proxy"],
      canServeRepositoryPath: () => false,
      normalizeRepositoryConfig: ({ config }) => {
        const demo = config.demo as { upstreamUrl?: string };
        return { demo: { upstreamUrl: `${demo.upstreamUrl}/` } };
      },
      validateRepositoryConfig: ({ config }) => {
        expect(config).toEqual({ demo: { upstreamUrl: "https://upstream.example/" } });
      },
    });
    const service = new PluginRepositoryService({
      repositoryService,
      plugins,
      pluginPolicyService: new PluginPolicyService({ state }),
    });

    await expect(service.create({
      name: "demo-proxy",
      ecosystem: "demo",
      kind: "proxy",
      visibility: "public",
      config: { demo: { upstreamUrl: "https://upstream.example" } },
    })).resolves.toMatchObject({
      name: "demo-proxy",
      ecosystem: "demo",
      kind: "proxy",
      config: { demo: { upstreamUrl: "https://upstream.example/" } },
    });
  });
});

describe("PluginRepositoryGroupDependencyService", () => {
  it("finds group repositories that include the updated repository as a member", async () => {
    const state = new MemoryStateStore();
    const repositoryService = new RepositoryService({ state, clock, randomId });
    await repositoryService.create({ name: "python-proxy", ecosystem: "pypi", kind: "proxy", config: {} });
    await repositoryService.create({
      name: "python-group",
      ecosystem: "pypi",
      kind: "group",
      config: { pypi: { members: ["python-proxy"] } },
    });
    await repositoryService.create({
      name: "other-python-group",
      ecosystem: "pypi",
      kind: "group",
      config: { pypi: { members: ["other-python"] } },
    });
    await repositoryService.create({
      name: "apt-group",
      ecosystem: "apt",
      kind: "group",
      config: { apt: { members: ["python-proxy"] } },
    });
    const plugins = new RepositoryRuntimePluginRegistry();
    plugins.register({
      kind: "group",
      repositoryKinds: [{ kind: "group", experimental: false }],
      ecosystem: "pypi",
      name: "pypi-group",
      version: "0.0.0",
      capabilities: ["group"],
      canServeRepositoryPath: () => false,
      getGroupMembers: ({ repository }) => (repository.config.pypi as { members: string[] }).members,
      validateRepositoryConfig: () => {},
    });
    plugins.register({
      kind: "group",
      repositoryKinds: [{ kind: "group", experimental: false }],
      ecosystem: "apt",
      name: "apt-group",
      version: "0.0.0",
      capabilities: ["group"],
      canServeRepositoryPath: () => false,
      getGroupMembers: ({ repository }) => (repository.config.apt as { members: string[] }).members,
      validateRepositoryConfig: () => {},
    });
    const service = new PluginRepositoryGroupDependencyService({ repositoryService, plugins });

    await expect(service.listGroupsDependingOn(await repositoryService.getByName("python-proxy")))
      .resolves.toMatchObject([{ name: "python-group" }]);
  });
});

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
      kind: "hosted",
      repositoryKinds: [{ kind: "hosted", experimental: false }],
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
      writeLock: new RepositoryWriteLock(),
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
          signingKeyId: "repository_config_key",
        },
      },
    });
    let authorizeSigningKeyIds: string[] | undefined;
    const plugins = new RepositoryRuntimePluginRegistry();
    plugins.register({
      kind: "hosted",
      repositoryKinds: [{ kind: "hosted", experimental: false }],
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
      writeLock: new RepositoryWriteLock(),
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
          signingKeyId: "repository_config_key",
        },
      },
    });
    const plugins = new RepositoryRuntimePluginRegistry();
    plugins.register({
      kind: "hosted",
      repositoryKinds: [{ kind: "hosted", experimental: false }],
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
      writeLock: new RepositoryWriteLock(),
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
      kind: "hosted",
      repositoryKinds: [{ kind: "hosted", experimental: false }],
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
      writeLock: new RepositoryWriteLock(),
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
      kind: "hosted",
      repositoryKinds: [{ kind: "hosted", experimental: false }],
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
      writeLock: new RepositoryWriteLock(),
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
      kind: "hosted",
      repositoryKinds: [{ kind: "hosted", experimental: false }],
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
      writeLock: new RepositoryWriteLock(),
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
      kind: "hosted",
      repositoryKinds: [{ kind: "hosted", experimental: false }],
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
      writeLock: new RepositoryWriteLock(),
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

  it("appends incremental artifact index batches instead of replacing each batch", async () => {
    const state = new MemoryStateStore();
    const repositoryService = new RepositoryService({ state, clock, randomId });
    await repositoryService.create({
      name: "python-proxy",
      ecosystem: "pypi",
      kind: "proxy",
      config: {},
    });
    const firstArtifact: RepositoryArtifactRecord = {
      id: "artifact_first",
      repositoryName: "python-proxy",
      ecosystem: "pypi",
      identity: "pypi:first:first-1.0.0.tar.gz",
      name: "first",
      version: "1.0.0",
      summary: "first 1.0.0",
      objectKeys: ["https://upstream.example/simple/first/first-1.0.0.tar.gz"],
      metadata: {},
      publishedAt: "2026-07-24T00:00:00.000Z",
      updatedAt: "2026-07-24T00:00:00.000Z",
    };
    const secondArtifact: RepositoryArtifactRecord = {
      ...firstArtifact,
      id: "artifact_second",
      identity: "pypi:second:second-1.0.0.tar.gz",
      name: "second",
      summary: "second 1.0.0",
      objectKeys: ["https://upstream.example/simple/second/second-1.0.0.tar.gz"],
    };
    let continuationSeen: unknown;
    const plugins = new RepositoryRuntimePluginRegistry();
    plugins.register({
      kind: "proxy",
      repositoryKinds: [{ kind: "proxy", experimental: true }],
      ecosystem: "pypi",
      name: "pypi-proxy-test",
      version: "0.0.0",
      capabilities: ["proxy"],
      canServeRepositoryPath: () => false,
      validateRepositoryConfig: () => {},
      artifacts: {
        rebuildIndex: async (input) => {
          continuationSeen = input.continuation;
          return input.continuation
            ? { artifacts: [secondArtifact], complete: true }
            : {
              artifacts: [firstArtifact],
              complete: false,
              continuation: { projectOffset: 1 },
              reset: true,
            };
        },
      },
    });
    const service = new PluginRepositoryArtifactIndexService({
      writeLock: new RepositoryWriteLock(),
      repositoryService,
      plugins,
      repositoryObjectStore: memoryObjectStore(),
      repositoryArtifactStore: state.repositoryArtifacts,
      clock,
    });

    await expect(service.rebuild({ repositoryName: "python-proxy" })).resolves.toMatchObject({
      complete: false,
      continuation: { projectOffset: 1 },
      artifactCount: 1,
    });
    await expect(state.repositoryArtifacts.listByRepository("python-proxy")).resolves.toEqual([firstArtifact]);

    await expect(service.rebuild({
      repositoryName: "python-proxy",
      continuation: { projectOffset: 1 },
    })).resolves.toMatchObject({
      complete: true,
      artifactCount: 2,
    });
    expect(continuationSeen).toEqual({ projectOffset: 1 });
    await expect(state.repositoryArtifacts.listByRepository("python-proxy")).resolves.toEqual([
      firstArtifact,
      secondArtifact,
    ]);
  });

  it("counts completed rebuild results without loading every stored artifact", async () => {
    const state = new MemoryStateStore();
    const repositoryService = new RepositoryService({ state, clock, randomId });
    await repositoryService.create({
      name: "python-proxy",
      ecosystem: "pypi",
      kind: "proxy",
      config: {},
    });
    const artifact: RepositoryArtifactRecord = {
      id: "artifact_first",
      repositoryName: "python-proxy",
      ecosystem: "pypi",
      identity: "pypi:first:first-1.0.0.tar.gz",
      name: "first",
      version: "1.0.0",
      summary: "first 1.0.0",
      objectKeys: ["https://upstream.example/simple/first/first-1.0.0.tar.gz"],
      metadata: {},
      publishedAt: "2026-07-24T00:00:00.000Z",
      updatedAt: "2026-07-24T00:00:00.000Z",
    };
    const plugins = new RepositoryRuntimePluginRegistry();
    plugins.register({
      kind: "proxy",
      repositoryKinds: [{ kind: "proxy", experimental: true }],
      ecosystem: "pypi",
      name: "pypi-proxy-test",
      version: "0.0.0",
      capabilities: ["proxy"],
      canServeRepositoryPath: () => false,
      validateRepositoryConfig: () => {},
      artifacts: {
        rebuildIndex: async () => [artifact],
      },
    });
    const artifactStore = {
      ...state.repositoryArtifacts,
      listByRepository: async () => {
        throw new Error("listByRepository should not be needed to count a completed rebuild");
      },
    };
    const service = new PluginRepositoryArtifactIndexService({
      writeLock: new RepositoryWriteLock(),
      repositoryService,
      plugins,
      repositoryObjectStore: memoryObjectStore(),
      repositoryArtifactStore: artifactStore,
      clock,
    });

    await expect(service.rebuild({ repositoryName: "python-proxy" })).resolves.toMatchObject({
      complete: true,
      artifactCount: 1,
    });
  });

});
