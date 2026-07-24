import {
  MemoryStateStore,
  PluginPolicyService,
  PublishSessionService,
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
import { RepositoryRuntimePluginRegistry } from "./repository-runtime-plugin-registry";
import { PluginPublishSessionService } from "./runtime-services";

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
  abortUpload: async () => {},
};

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
});
