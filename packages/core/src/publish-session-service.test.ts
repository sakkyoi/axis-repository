import { describe, expect, it } from "vitest";
import {
  ForbiddenError,
  MemoryStateStore,
  NotFoundError,
  PublishSessionService,
  ValidationError,
  type Clock,
  type ArtifactPublisher,
  type PublishArtifactRequest,
  type PublishSession,
  type RandomId,
  type StateStore,
  type TokenPrincipal,
  type UploadBroker,
} from "./index";

const clock: Clock = {
  now: () => new Date("2026-07-12T00:00:00.000Z"),
};

const expiredClock: Clock = {
  now: () => new Date("2026-07-12T00:30:00.000Z"),
};

const randomId: RandomId = {
  create: (prefix: string) => `${prefix}_fixed`,
};

const principal: TokenPrincipal = {
  tokenId: "tok_1",
  name: "github-actions",
  permissions: ["publish"],
  repositories: ["debian-internal"],
  ecosystemScopes: {},
};

const artifact: PublishArtifactRequest = {
  filename: "myapp_1.2.3_amd64.deb",
  size: 1234,
  sha256: "a".repeat(64),
  contentType: "application/vnd.debian.binary-package",
  metadata: {},
};

const uploadBroker: UploadBroker = {
  createUploadTarget: async ({ sessionId, uploadId, artifact, expiresAt }) => ({
    uploadId,
    filename: artifact.filename,
    objectKey: `_staging/uploads/${sessionId}/${uploadId}/${artifact.filename}`,
    method: "PUT",
    url: `https://uploads.example/${uploadId}`,
    headers: {
      "content-type": artifact.contentType,
      "x-amz-meta-axis-sha256": artifact.sha256,
      "x-amz-meta-axis-upload-id": uploadId,
    },
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

function createPublisher(): { publisher: ArtifactPublisher; calls: Parameters<ArtifactPublisher["publish"]>[0][] } {
  const calls: Parameters<ArtifactPublisher["publish"]>[0][] = [];
  return {
    calls,
    publisher: {
      publish: async (input) => {
        calls.push(input);
        return {
          publishedAt: "2026-07-12T00:00:00.000Z",
          objects: [
            {
              key: `repositories/${input.repository.name}/publishes/${input.session.id}.json`,
              contentType: "application/json; charset=utf-8",
            },
          ],
        };
      },
    },
  };
}

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void } {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

async function createStateWithRepository(): Promise<MemoryStateStore> {
  const state = new MemoryStateStore();
  await state.repositories.save({
    id: "repo_1",
    name: "debian-internal",
    ecosystem: "apt",
    visibility: "private",
    config: {},
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
  });
  return state;
}

describe("PublishSessionService", () => {
  it("creates a publish session with upload targets and artifacts", async () => {
    const state = await createStateWithRepository();
    const service = new PublishSessionService({ state, uploadBroker, clock, randomId });

    const session = await service.create({
      repositoryName: "debian-internal",
      ecosystem: "apt",
      principal,
      artifacts: [artifact],
    });

    expect(session.id).toBe("pub_fixed");
    expect(session.uploads).toHaveLength(1);
    expect(session.uploads[0]?.url).toBe("https://uploads.example/upl_fixed");
    expect(session.artifacts).toEqual([artifact]);
    expect(session.artifacts[0]).not.toBe(artifact);
    expect(session.artifacts[0]?.metadata).not.toBe(artifact.metadata);
    expect(session.status).toBe("pending_uploads");
    expect(session.verifiedUploads).toEqual([]);
    expect(await state.publishSessions.get("pub_fixed")).toEqual(session);
  });

  it("stores nested artifact metadata independently from caller mutations", async () => {
    const state = await createStateWithRepository();
    const service = new PublishSessionService({ state, uploadBroker, clock, randomId });
    const nestedMetadata = {
      checks: ["lint", "sign"],
      package: {
        maintainer: "release@example.com",
        tags: ["stable"],
      },
    };

    await service.create({
      repositoryName: "debian-internal",
      ecosystem: "apt",
      principal,
      artifacts: [
        {
          ...artifact,
          metadata: nestedMetadata,
        },
      ],
    });

    nestedMetadata.checks.push("tampered");
    nestedMetadata.package.maintainer = "tampered@example.com";
    nestedMetadata.package.tags.push("tampered");

    const stored = await state.publishSessions.get("pub_fixed");

    expect(stored?.artifacts[0]?.metadata).toEqual({
      checks: ["lint", "sign"],
      package: {
        maintainer: "release@example.com",
        tags: ["stable"],
      },
    });
  });

  it("snapshots nested artifact metadata before awaited work", async () => {
    const state = await createStateWithRepository();
    const service = new PublishSessionService({ state, uploadBroker, clock, randomId });
    const input = {
      repositoryName: "debian-internal",
      ecosystem: "apt" as const,
      principal,
      artifacts: [
        {
          ...artifact,
          metadata: {
            checks: ["lint", "sign"],
            package: {
              maintainer: "release@example.com",
              tags: ["stable"],
            },
          },
        },
      ],
    };

    const promise = service.create(input);
    const metadata = input.artifacts[0]?.metadata;
    if (!metadata || !("package" in metadata)) {
      throw new Error("Expected nested package metadata");
    }
    (metadata.package as { maintainer: string; tags: string[] }).maintainer = "tampered@example.com";
    (metadata.package as { maintainer: string; tags: string[] }).tags.push("tampered");

    await promise;

    const stored = await state.publishSessions.get("pub_fixed");

    expect(stored?.artifacts[0]?.metadata).toEqual({
      checks: ["lint", "sign"],
      package: {
        maintainer: "release@example.com",
        tags: ["stable"],
      },
    });
  });

  it("persists verified uploads and marks the session ready when all uploads are verified", async () => {
    const state = await createStateWithRepository();
    const service = new PublishSessionService({ state, uploadBroker, clock, randomId });
    await service.create({
      repositoryName: "debian-internal",
      ecosystem: "apt",
      principal,
      artifacts: [artifact],
    });

    const result = await service.verifyUpload({
      sessionId: "pub_fixed",
      uploadId: "upl_fixed",
      principal,
    });

    expect(result.upload).toEqual({
      uploadId: "upl_fixed",
      objectKey: "_staging/uploads/pub_fixed/upl_fixed/myapp_1.2.3_amd64.deb",
      size: 1234,
      sha256: "a".repeat(64),
      verifiedAt: "2026-07-12T00:00:00.000Z",
    });
    expect(result.session.status).toBe("ready");
    expect(result.session.verifiedUploads).toEqual([result.upload]);
    await expect(state.publishSessions.get("pub_fixed")).resolves.toMatchObject({
      status: "ready",
      verifiedUploads: [result.upload],
    });
  });

  it("keeps a session pending until every upload is verified", async () => {
    const state = await createStateWithRepository();
    let uploadCount = 0;
    const sequentialRandomId: RandomId = {
      create: (prefix: string) => {
        if (prefix === "pub") {
          return "pub_fixed";
        }
        if (prefix === "upl") {
          uploadCount += 1;
          return `upl_${uploadCount}`;
        }
        return `${prefix}_fixed`;
      },
    };
    const service = new PublishSessionService({ state, uploadBroker, clock, randomId: sequentialRandomId });

    await service.create({
      repositoryName: "debian-internal",
      ecosystem: "apt",
      principal,
      artifacts: [
        artifact,
        {
          ...artifact,
          filename: "myapp-dbgsym_1.2.3_amd64.deb",
          sha256: "b".repeat(64),
        },
      ],
    });

    const first = await service.verifyUpload({
      sessionId: "pub_fixed",
      uploadId: "upl_1",
      principal,
    });
    expect(first.session.status).toBe("pending_uploads");
    expect(first.session.verifiedUploads).toEqual([first.upload]);

    const second = await service.verifyUpload({
      sessionId: "pub_fixed",
      uploadId: "upl_2",
      principal,
    });
    expect(second.session.status).toBe("ready");
    expect(second.session.verifiedUploads).toEqual([first.upload, second.upload]);
  });

  it("replaces an existing verified upload record when re-verifying", async () => {
    const state = await createStateWithRepository();
    const service = new PublishSessionService({ state, uploadBroker, clock, randomId });
    await service.create({
      repositoryName: "debian-internal",
      ecosystem: "apt",
      principal,
      artifacts: [artifact],
    });

    await service.verifyUpload({
      sessionId: "pub_fixed",
      uploadId: "upl_fixed",
      principal,
    });
    await service.verifyUpload({
      sessionId: "pub_fixed",
      uploadId: "upl_fixed",
      principal,
    });

    const stored = await state.publishSessions.get("pub_fixed");

    expect(stored?.verifiedUploads).toHaveLength(1);
    expect(stored?.verifiedUploads[0]?.uploadId).toBe("upl_fixed");
  });

  it("rejects upload verification when the token is not scoped to the repository", async () => {
    const state = await createStateWithRepository();
    const service = new PublishSessionService({ state, uploadBroker, clock, randomId });
    await service.create({
      repositoryName: "debian-internal",
      ecosystem: "apt",
      principal,
      artifacts: [artifact],
    });

    await expect(
      service.verifyUpload({
        sessionId: "pub_fixed",
        uploadId: "upl_fixed",
        principal: { ...principal, repositories: ["other"] },
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects upload verification for expired sessions", async () => {
    const state = await createStateWithRepository();
    const createService = new PublishSessionService({ state, uploadBroker, clock, randomId });
    await createService.create({
      repositoryName: "debian-internal",
      ecosystem: "apt",
      principal,
      artifacts: [artifact],
    });

    const verifyService = new PublishSessionService({
      state,
      uploadBroker,
      clock: expiredClock,
      randomId,
    });

    await expect(
      verifyService.verifyUpload({
        sessionId: "pub_fixed",
        uploadId: "upl_fixed",
        principal,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects upload verification for unknown uploads", async () => {
    const state = await createStateWithRepository();
    const service = new PublishSessionService({ state, uploadBroker, clock, randomId });
    await service.create({
      repositoryName: "debian-internal",
      ecosystem: "apt",
      principal,
      artifacts: [artifact],
    });

    await expect(
      service.verifyUpload({
        sessionId: "pub_fixed",
        uploadId: "missing",
        principal,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects finalize before every upload is verified", async () => {
    const state = await createStateWithRepository();
    const { publisher } = createPublisher();
    const service = new PublishSessionService({ state, uploadBroker, artifactPublisher: publisher, clock, randomId });
    await service.create({
      repositoryName: "debian-internal",
      ecosystem: "apt",
      principal,
      artifacts: [artifact],
    });

    await expect(
      service.finalize({
        sessionId: "pub_fixed",
        principal,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("finalizes a ready session and stores the publish result", async () => {
    const state = await createStateWithRepository();
    const { publisher, calls } = createPublisher();
    const service = new PublishSessionService({ state, uploadBroker, artifactPublisher: publisher, clock, randomId });
    await service.create({
      repositoryName: "debian-internal",
      ecosystem: "apt",
      principal,
      artifacts: [artifact],
    });
    await service.verifyUpload({
      sessionId: "pub_fixed",
      uploadId: "upl_fixed",
      principal,
    });

    const result = await service.finalize({
      sessionId: "pub_fixed",
      principal,
    });

    const expectedPublishResult = {
      publishedAt: "2026-07-12T00:00:00.000Z",
      objects: [
        {
          key: "repositories/debian-internal/publishes/pub_fixed.json",
          contentType: "application/json; charset=utf-8",
        },
      ],
    };
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      repository: { name: "debian-internal" },
      session: { id: "pub_fixed", status: "finalizing" },
      artifacts: [
        {
          artifact,
          upload: expect.objectContaining({
            uploadId: "upl_fixed",
            method: "PUT",
          }),
          verified: expect.objectContaining({
            uploadId: "upl_fixed",
            verifiedAt: "2026-07-12T00:00:00.000Z",
          }),
        },
      ],
    });
    expect(result.result).toEqual(expectedPublishResult);
    expect(result.session.status).toBe("finalized");
    expect(result.session.finalizedAt).toBe("2026-07-12T00:00:00.000Z");
    expect(result.session.publishResult).toEqual(expectedPublishResult);
    await expect(state.publishSessions.get("pub_fixed")).resolves.toMatchObject({
      status: "finalized",
      finalizedAt: "2026-07-12T00:00:00.000Z",
      publishResult: expectedPublishResult,
    });
  });

  it("rejects stale upload verification without reopening a finalized session", async () => {
    const state = await createStateWithRepository();
    const { publisher } = createPublisher();
    const verifyEntered = deferred();
    const releaseVerify = deferred();
    const blockingUploadBroker: UploadBroker = {
      ...uploadBroker,
      verifyUpload: async ({ target, expected }) => {
        verifyEntered.resolve();
        await releaseVerify.promise;
        return uploadBroker.verifyUpload({ target, expected });
      },
    };
    const setupService = new PublishSessionService({ state, uploadBroker, artifactPublisher: publisher, clock, randomId });
    await setupService.create({
      repositoryName: "debian-internal",
      ecosystem: "apt",
      principal,
      artifacts: [artifact],
    });
    await setupService.verifyUpload({
      sessionId: "pub_fixed",
      uploadId: "upl_fixed",
      principal,
    });
    const service = new PublishSessionService({
      state,
      uploadBroker: blockingUploadBroker,
      artifactPublisher: publisher,
      clock,
      randomId,
    });

    const staleVerify = service.verifyUpload({
      sessionId: "pub_fixed",
      uploadId: "upl_fixed",
      principal,
    });
    await verifyEntered.promise;
    await expect(
      service.finalize({
        sessionId: "pub_fixed",
        principal,
      }),
    ).resolves.toMatchObject({
      session: { status: "finalized" },
    });

    releaseVerify.resolve();

    await expect(staleVerify).rejects.toThrow(
      new ValidationError("Publish session is not open: finalized"),
    );
    await expect(state.publishSessions.get("pub_fixed")).resolves.toMatchObject({
      status: "finalized",
      publishResult: {
        objects: [
          {
            key: "repositories/debian-internal/publishes/pub_fixed.json",
            contentType: "application/json; charset=utf-8",
          },
        ],
      },
    });
  });

  it("marks the session failed when the publisher throws", async () => {
    const state = await createStateWithRepository();
    const service = new PublishSessionService({
      state,
      uploadBroker,
      artifactPublisher: {
        publish: async () => {
          throw new Error("write failed");
        },
      },
      clock,
      randomId,
    });
    await service.create({
      repositoryName: "debian-internal",
      ecosystem: "apt",
      principal,
      artifacts: [artifact],
    });
    await service.verifyUpload({
      sessionId: "pub_fixed",
      uploadId: "upl_fixed",
      principal,
    });

    await expect(
      service.finalize({
        sessionId: "pub_fixed",
        principal,
      }),
    ).rejects.toThrow("write failed");
    await expect(state.publishSessions.get("pub_fixed")).resolves.toMatchObject({
      status: "failed",
      failure: {
        message: "write failed",
        failedAt: "2026-07-12T00:00:00.000Z",
      },
    });
  });

  it("allows only one concurrent finalize call to claim a ready session", async () => {
    const backingState = await createStateWithRepository();
    let finalizingSaveCalls = 0;
    let releaseFinalizingSaves!: () => void;
    const finalizingSaveBlocker = new Promise<void>((resolve) => {
      releaseFinalizingSaves = resolve;
    });
    const state: StateStore = {
      repositories: backingState.repositories,
      publishTokens: backingState.publishTokens,
      publishSessions: {
        ...backingState.publishSessions,
        save: async (session: PublishSession) => {
          if (session.status === "finalizing") {
            finalizingSaveCalls += 1;
            await finalizingSaveBlocker;
          }
          await backingState.publishSessions.save(session);
        },
      },
    };
    const result = {
      publishedAt: "2026-07-12T00:00:00.000Z",
      objects: [
        {
          key: "repositories/debian-internal/publishes/pub_fixed.json",
          contentType: "application/json; charset=utf-8",
        },
      ],
    };
    let publishCalls = 0;
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });
    const service = new PublishSessionService({
      state,
      uploadBroker,
      artifactPublisher: {
        publish: async () => {
          publishCalls += 1;
          await blocker;
          return result;
        },
      },
      clock,
      randomId,
    });
    await service.create({
      repositoryName: "debian-internal",
      ecosystem: "apt",
      principal,
      artifacts: [artifact],
    });
    await service.verifyUpload({
      sessionId: "pub_fixed",
      uploadId: "upl_fixed",
      principal,
    });

    const firstFinalize = service.finalize({
      sessionId: "pub_fixed",
      principal,
    });
    for (let attempt = 0; attempt < 10 && publishCalls === 0 && finalizingSaveCalls === 0; attempt += 1) {
      await Promise.resolve();
    }
    expect(publishCalls + finalizingSaveCalls).toBeGreaterThan(0);

    const secondFinalize = service.finalize({
      sessionId: "pub_fixed",
      principal,
    });
    for (let attempt = 0; attempt < 10 && finalizingSaveCalls === 1; attempt += 1) {
      await Promise.resolve();
    }
    releaseFinalizingSaves();

    const secondFinalizeExpectation = expect(secondFinalize).rejects.toBeInstanceOf(ValidationError);
    release();
    await secondFinalizeExpectation;
    await expect(firstFinalize).resolves.toMatchObject({
      result,
      session: { status: "finalized" },
    });
    expect(publishCalls).toBe(1);
  });

  it("surfaces finalized session save failures without marking the session failed", async () => {
    const backingState = await createStateWithRepository();
    const state: StateStore = {
      repositories: backingState.repositories,
      publishTokens: backingState.publishTokens,
      publishSessions: {
        ...backingState.publishSessions,
        save: async (session: PublishSession) => {
          if (session.status === "finalized") {
            throw new Error("finalized save failed");
          }
          await backingState.publishSessions.save(session);
        },
      },
    };
    const { publisher } = createPublisher();
    const service = new PublishSessionService({ state, uploadBroker, artifactPublisher: publisher, clock, randomId });
    await service.create({
      repositoryName: "debian-internal",
      ecosystem: "apt",
      principal,
      artifacts: [artifact],
    });
    await service.verifyUpload({
      sessionId: "pub_fixed",
      uploadId: "upl_fixed",
      principal,
    });

    await expect(
      service.finalize({
        sessionId: "pub_fixed",
        principal,
      }),
    ).rejects.toThrow("finalized save failed");

    const stored = await backingState.publishSessions.get("pub_fixed");
    expect(stored?.status).toBe("finalizing");
    expect(stored?.failure).toBeUndefined();
  });

  it("rejects finalize when the token is not scoped to the repository", async () => {
    const state = await createStateWithRepository();
    const { publisher } = createPublisher();
    const service = new PublishSessionService({ state, uploadBroker, artifactPublisher: publisher, clock, randomId });
    await service.create({
      repositoryName: "debian-internal",
      ecosystem: "apt",
      principal,
      artifacts: [artifact],
    });
    await service.verifyUpload({
      sessionId: "pub_fixed",
      uploadId: "upl_fixed",
      principal,
    });

    await expect(
      service.finalize({
        sessionId: "pub_fixed",
        principal: { ...principal, repositories: ["other"] },
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects publish when token is not scoped to repository", async () => {
    const state = new MemoryStateStore();
    await state.repositories.save({
      id: "repo_1",
      name: "python-internal",
      ecosystem: "pypi",
      visibility: "private",
      config: {},
      createdAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-12T00:00:00.000Z",
    });
    const service = new PublishSessionService({ state, uploadBroker, clock, randomId });

    await expect(
      service.create({
        repositoryName: "python-internal",
        ecosystem: "pypi",
        principal,
        artifacts: [],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects unknown repositories", async () => {
    const service = new PublishSessionService({
      state: new MemoryStateStore(),
      uploadBroker,
      clock,
      randomId,
    });

    await expect(
      service.create({
        repositoryName: "missing",
        ecosystem: "apt",
        principal,
        artifacts: [],
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
