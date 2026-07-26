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
} from "../index";

const clock: Clock = {
  now: () => new Date("2026-07-12T00:00:00.000Z"),
};

const expiredClock: Clock = {
  now: () => new Date("2026-07-12T00:30:00.000Z"),
};

const staleFinalizingClock: Clock = {
  now: () => new Date("2026-07-12T00:02:00.000Z"),
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
  signingKeyIds: [],
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
  it("lists only publish sessions scoped to the token repositories", async () => {
    const state = await createStateWithRepository();
    await state.repositories.save({
      id: "repo_2",
      name: "python-internal",
      ecosystem: "pypi",
      visibility: "private",
      config: {},
      createdAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-12T00:00:00.000Z",
    });
    await state.publishSessions.save({
      id: "pub_apt_old",
      repositoryName: "debian-internal",
      ecosystem: "apt",
      status: "finalized",
      requestedBy: principal,
      artifacts: [],
      uploads: [],
      verifiedUploads: [],
      createdAt: "2026-07-12T00:01:00.000Z",
      expiresAt: "2026-07-12T00:16:00.000Z",
    });
    await state.publishSessions.save({
      id: "pub_pypi",
      repositoryName: "python-internal",
      ecosystem: "pypi",
      status: "finalized",
      requestedBy: { ...principal, repositories: ["python-internal"] },
      artifacts: [],
      uploads: [],
      verifiedUploads: [],
      createdAt: "2026-07-12T00:03:00.000Z",
      expiresAt: "2026-07-12T00:18:00.000Z",
    });
    await state.publishSessions.save({
      id: "pub_apt_new",
      repositoryName: "debian-internal",
      ecosystem: "apt",
      status: "ready",
      requestedBy: principal,
      artifacts: [],
      uploads: [],
      verifiedUploads: [],
      createdAt: "2026-07-12T00:02:00.000Z",
      expiresAt: "2026-07-12T00:17:00.000Z",
    });
    const service = new PublishSessionService({ state, uploadBroker, clock, randomId });

    await expect(service.list({ principal })).resolves.toMatchObject([
      { id: "pub_apt_new" },
      { id: "pub_apt_old" },
    ]);
  });

  it("reports an out-of-scope session as not found rather than forbidden", async () => {
    const state = await createStateWithRepository();
    await state.publishSessions.save({
      id: "pub_1",
      repositoryName: "debian-internal",
      ecosystem: "apt",
      status: "ready",
      requestedBy: principal,
      artifacts: [],
      uploads: [],
      verifiedUploads: [],
      createdAt: "2026-07-12T00:00:00.000Z",
      expiresAt: "2026-07-12T00:15:00.000Z",
    });
    const service = new PublishSessionService({ state, uploadBroker, clock, randomId });

    await expect(service.get({ sessionId: "pub_1", principal })).resolves.toMatchObject({
      id: "pub_1",
    });
    // An existing out-of-scope session and an unknown id must be
    // indistinguishable, so a session id cannot be probed for existence.
    await expect(
      service.get({
        sessionId: "pub_1",
        principal: { ...principal, repositories: ["python-internal"] },
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      service.get({ sessionId: "pub_missing", principal }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws not found when getting an unknown publish session", async () => {
    const state = await createStateWithRepository();
    const service = new PublishSessionService({ state, uploadBroker, clock, randomId });

    await expect(service.get({ sessionId: "pub_missing", principal })).rejects.toBeInstanceOf(NotFoundError);
  });

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

  it("treats existing sessions without verifiedUploads as pending verification state", async () => {
    const state = await createStateWithRepository();
    const service = new PublishSessionService({ state, uploadBroker, clock, randomId });
    const created = await service.create({
      repositoryName: "debian-internal",
      ecosystem: "apt",
      principal,
      artifacts: [artifact],
    });
    const legacySession = { ...created, status: "created" as never };
    delete (legacySession as Partial<PublishSession>).verifiedUploads;
    await state.publishSessions.save(legacySession);

    const result = await service.verifyUpload({
      sessionId: "pub_fixed",
      uploadId: "upl_fixed",
      principal,
    });

    expect(result.session.status).toBe("ready");
    expect(result.session.verifiedUploads).toHaveLength(1);
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

  it("merges concurrent upload verification results from the latest stored session", async () => {
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
    let enteredVerify = 0;
    const bothVerifyCallsEntered = deferred();
    const releaseVerifyCalls = deferred();
    const blockingUploadBroker: UploadBroker = {
      ...uploadBroker,
      verifyUpload: async ({ target, expected }) => {
        enteredVerify += 1;
        if (enteredVerify === 2) {
          bothVerifyCallsEntered.resolve();
        }
        await releaseVerifyCalls.promise;
        return uploadBroker.verifyUpload({ target, expected });
      },
    };
    const service = new PublishSessionService({
      state,
      uploadBroker: blockingUploadBroker,
      clock,
      randomId: sequentialRandomId,
    });
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

    const firstVerify = service.verifyUpload({
      sessionId: "pub_fixed",
      uploadId: "upl_1",
      principal,
    });
    const secondVerify = service.verifyUpload({
      sessionId: "pub_fixed",
      uploadId: "upl_2",
      principal,
    });
    await bothVerifyCallsEntered.promise;

    releaseVerifyCalls.resolve();
    const [first, second] = await Promise.all([firstVerify, secondVerify]);
    const stored = await state.publishSessions.get("pub_fixed");

    expect(first.upload.uploadId).toBe("upl_1");
    expect(second.upload.uploadId).toBe("upl_2");
    expect(stored?.status).toBe("ready");
    expect(stored?.verifiedUploads).toEqual([first.upload, second.upload]);
    expect(first.session.verifiedUploads).toContainEqual(first.upload);
    expect(second.session.verifiedUploads).toContainEqual(second.upload);
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

  it("hides upload verification for a session outside the token scope", async () => {
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
    ).rejects.toBeInstanceOf(NotFoundError);
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

  it("rejects finalize for expired ready sessions", async () => {
    const state = await createStateWithRepository();
    const { publisher, calls } = createPublisher();
    const createService = new PublishSessionService({
      state,
      uploadBroker,
      artifactPublisher: publisher,
      clock,
      randomId,
    });
    await createService.create({
      repositoryName: "debian-internal",
      ecosystem: "apt",
      principal,
      artifacts: [artifact],
    });
    await createService.verifyUpload({
      sessionId: "pub_fixed",
      uploadId: "upl_fixed",
      principal,
    });

    const expiredService = new PublishSessionService({
      state,
      uploadBroker,
      artifactPublisher: publisher,
      clock: expiredClock,
      randomId,
    });

    await expect(
      expiredService.finalize({
        sessionId: "pub_fixed",
        principal,
      }),
    ).rejects.toThrow(new ValidationError("Publish session has expired"));
    expect(calls).toHaveLength(0);
    await expect(state.publishSessions.get("pub_fixed")).resolves.toMatchObject({
      status: "ready",
    });
  });

  it("rejects finalize for legacy completed sessions", async () => {
    const state = await createStateWithRepository();
    const { publisher } = createPublisher();
    const service = new PublishSessionService({ state, uploadBroker, artifactPublisher: publisher, clock, randomId });
    const created = await service.create({
      repositoryName: "debian-internal",
      ecosystem: "apt",
      principal,
      artifacts: [artifact],
    });
    await state.publishSessions.save({ ...created, status: "completed" as never });

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
    expect(result.session.publishStartedAt).toBe("2026-07-12T00:00:00.000Z");
    expect(result.session.finalizingStartedAt).toBe("2026-07-12T00:00:00.000Z");
    expect(result.session.finalizedAt).toBe("2026-07-12T00:00:00.000Z");
    expect(result.session.publishResult).toEqual(expectedPublishResult);
    await expect(state.publishSessions.get("pub_fixed")).resolves.toMatchObject({
      status: "finalized",
      publishStartedAt: "2026-07-12T00:00:00.000Z",
      finalizingStartedAt: "2026-07-12T00:00:00.000Z",
      finalizedAt: "2026-07-12T00:00:00.000Z",
      publishResult: expectedPublishResult,
    });
  });

  it("finalizes using the latest verified upload after re-verification", async () => {
    const backingState = await createStateWithRepository();
    const { publisher, calls } = createPublisher();
    let verifyCalls = 0;
    const reverifyUploadBroker: UploadBroker = {
      ...uploadBroker,
      verifyUpload: async ({ target, expected }) => {
        verifyCalls += 1;
        return {
          uploadId: target.uploadId,
          objectKey: verifyCalls === 1 ? target.objectKey : `${target.objectKey}.rev2`,
          size: expected.size,
          sha256: expected.sha256,
        };
      },
    };
    const setupService = new PublishSessionService({
      state: backingState,
      uploadBroker: reverifyUploadBroker,
      artifactPublisher: publisher,
      clock,
      randomId,
    });
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

    let reverified = false;
    const reverifyService = new PublishSessionService({
      state: backingState,
      uploadBroker: reverifyUploadBroker,
      artifactPublisher: publisher,
      clock,
      randomId,
    });
    const state: StateStore = {
      repositories: {
        ...backingState.repositories,
        getByName: async (name: string) => {
          if (!reverified) {
            reverified = true;
            await reverifyService.verifyUpload({
              sessionId: "pub_fixed",
              uploadId: "upl_fixed",
              principal,
            });
          }
          return backingState.repositories.getByName(name);
        },
      },
      publishTokens: backingState.publishTokens,
      adminUsers: backingState.adminUsers,
      adminRefreshSessions: backingState.adminRefreshSessions,
      publishSessions: backingState.publishSessions,
      repositorySecrets: backingState.repositorySecrets,
      repositoryPluginPolicies: backingState.repositoryPluginPolicies,
      repositoryActivities: backingState.repositoryActivities,
      repositoryArtifacts: backingState.repositoryArtifacts,
    };
    const service = new PublishSessionService({
      state,
      uploadBroker: reverifyUploadBroker,
      artifactPublisher: publisher,
      clock,
      randomId,
    });

    await expect(
      service.finalize({
        sessionId: "pub_fixed",
        principal,
      }),
    ).resolves.toMatchObject({
      session: { status: "finalized" },
    });

    const latestObjectKey = "_staging/uploads/pub_fixed/upl_fixed/myapp_1.2.3_amd64.deb.rev2";
    expect(calls).toHaveLength(1);
    expect(calls[0]?.artifacts[0]?.verified.objectKey).toBe(latestObjectKey);
    await expect(backingState.publishSessions.get("pub_fixed")).resolves.toMatchObject({
      status: "finalized",
      verifiedUploads: [
        expect.objectContaining({
          uploadId: "upl_fixed",
          objectKey: latestObjectKey,
        }),
      ],
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
      adminUsers: backingState.adminUsers,
      adminRefreshSessions: backingState.adminRefreshSessions,
      repositorySecrets: backingState.repositorySecrets,
      repositoryPluginPolicies: backingState.repositoryPluginPolicies,
      repositoryActivities: backingState.repositoryActivities,
      repositoryArtifacts: backingState.repositoryArtifacts,
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

    const secondFinalizeExpectation = expect(secondFinalize).rejects.toThrow(
      new ValidationError("Publish session is already finalizing"),
    );
    release();
    await secondFinalizeExpectation;
    await expect(firstFinalize).resolves.toMatchObject({
      result,
      session: { status: "finalized" },
    });
    expect(publishCalls).toBe(1);
  });

  it("retries finalizing sessions after a finalized session save failure", async () => {
    const backingState = await createStateWithRepository();
    let failFinalizedSave = true;
    const state: StateStore = {
      repositories: backingState.repositories,
      publishTokens: backingState.publishTokens,
      adminUsers: backingState.adminUsers,
      adminRefreshSessions: backingState.adminRefreshSessions,
      repositorySecrets: backingState.repositorySecrets,
      repositoryPluginPolicies: backingState.repositoryPluginPolicies,
      repositoryActivities: backingState.repositoryActivities,
      repositoryArtifacts: backingState.repositoryArtifacts,
      publishSessions: {
        ...backingState.publishSessions,
        update: async (id, updater) => {
          const current = await backingState.publishSessions.get(id);
          if (!current) {
            return null;
          }
          const updated = updater(current);
          if (updated.status === "finalized" && failFinalizedSave) {
            failFinalizedSave = false;
            throw new Error("finalized save failed");
          }
          await backingState.publishSessions.save(updated);
          return updated;
        },
      },
    };
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

    await expect(
      service.finalize({
        sessionId: "pub_fixed",
        principal,
      }),
    ).rejects.toThrow("finalized save failed");

    const stored = await backingState.publishSessions.get("pub_fixed");
    expect(stored?.status).toBe("finalizing");
    expect(stored?.publishStartedAt).toBe("2026-07-12T00:00:00.000Z");
    expect(stored?.failure).toBeUndefined();

    await expect(
      new PublishSessionService({
        state,
        uploadBroker,
        artifactPublisher: publisher,
        clock: staleFinalizingClock,
        randomId,
      }).finalize({
        sessionId: "pub_fixed",
        principal,
      }),
    ).resolves.toMatchObject({
      session: {
        status: "finalized",
        publishResult: {
          objects: [
            {
              key: "repositories/debian-internal/publishes/pub_fixed.json",
              contentType: "application/json; charset=utf-8",
            },
          ],
        },
      },
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.session.publishStartedAt).toBe("2026-07-12T00:00:00.000Z");
    expect(calls[1]?.session.publishStartedAt).toBe("2026-07-12T00:00:00.000Z");
    expect(calls[0]?.session.finalizingStartedAt).toBe("2026-07-12T00:00:00.000Z");
    expect(calls[1]?.session.finalizingStartedAt).toBe("2026-07-12T00:02:00.000Z");
    const finalized = await backingState.publishSessions.get("pub_fixed");
    expect(finalized?.status).toBe("finalized");
    expect(finalized?.publishStartedAt).toBe("2026-07-12T00:00:00.000Z");
    expect(finalized?.finalizingStartedAt).toBe("2026-07-12T00:02:00.000Z");
    expect(finalized?.failure).toBeUndefined();
  });

  it("rejects stale terminal saves after another finalize retry reclaims the lease", async () => {
    const state = await createStateWithRepository();
    const firstPublishEntered = deferred();
    const releaseFirstPublish = deferred();
    let publishCalls = 0;
    const publisher: ArtifactPublisher = {
      publish: async (input) => {
        publishCalls += 1;
        if (publishCalls === 1) {
          firstPublishEntered.resolve();
          await releaseFirstPublish.promise;
        }
        return {
          publishedAt: input.session.publishStartedAt ?? "missing",
          objects: [
            {
              key: `repositories/${input.repository.name}/publishes/${input.session.id}.json`,
              contentType: "application/json; charset=utf-8",
            },
          ],
        };
      },
    };
    const service = new PublishSessionService({
      state,
      uploadBroker,
      artifactPublisher: publisher,
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
    await firstPublishEntered.promise;

    const retryService = new PublishSessionService({
      state,
      uploadBroker,
      artifactPublisher: publisher,
      clock: staleFinalizingClock,
      randomId,
    });
    await expect(
      retryService.finalize({
        sessionId: "pub_fixed",
        principal,
      }),
    ).resolves.toMatchObject({
      session: {
        status: "finalized",
        finalizingStartedAt: "2026-07-12T00:02:00.000Z",
      },
    });

    releaseFirstPublish.resolve();
    await expect(firstFinalize).rejects.toThrow(
      new ValidationError("Publish session finalizing lease has changed"),
    );
    expect(publishCalls).toBe(2);
    await expect(state.publishSessions.get("pub_fixed")).resolves.toMatchObject({
      status: "finalized",
      finalizingStartedAt: "2026-07-12T00:02:00.000Z",
    });
  });

  it("hides finalize for a session outside the token scope", async () => {
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
    ).rejects.toBeInstanceOf(NotFoundError);
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

  it("requires the publish permission before anything else", async () => {
    const state = new MemoryStateStore();
    await state.repositories.save({
      id: "repo_apt",
      name: "debian-internal",
      ecosystem: "apt",
      visibility: "private",
      config: {},
      createdAt: "2026-07-23T00:00:00.000Z",
      updatedAt: "2026-07-23T00:00:00.000Z",
    });
    const service = new PublishSessionService({ state, uploadBroker, clock, randomId });
    const readOnly: TokenPrincipal = { ...principal, permissions: ["read"] };

    await expect(
      service.create({ repositoryName: "debian-internal", ecosystem: "apt", principal: readOnly, artifacts: [artifact] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.list({ principal: readOnly })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      service.get({ sessionId: "pub_1", principal: readOnly }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects a repository whose ecosystem does not match the request", async () => {
    const state = new MemoryStateStore();
    await state.repositories.save({
      id: "repo_apt",
      name: "debian-internal",
      ecosystem: "pypi",
      visibility: "private",
      config: {},
      createdAt: "2026-07-23T00:00:00.000Z",
      updatedAt: "2026-07-23T00:00:00.000Z",
    });
    const service = new PublishSessionService({ state, uploadBroker, clock, randomId });

    await expect(
      service.create({ repositoryName: "debian-internal", ecosystem: "apt", principal, artifacts: [artifact] }),
    ).rejects.toThrow("Repository debian-internal is not a apt repository");
  });

  it("requires at least one artifact", async () => {
    const state = new MemoryStateStore();
    await state.repositories.save({
      id: "repo_apt",
      name: "debian-internal",
      ecosystem: "apt",
      visibility: "private",
      config: {},
      createdAt: "2026-07-23T00:00:00.000Z",
      updatedAt: "2026-07-23T00:00:00.000Z",
    });
    const service = new PublishSessionService({ state, uploadBroker, clock, randomId });

    await expect(
      service.create({ repositoryName: "debian-internal", ecosystem: "apt", principal, artifacts: [] }),
    ).rejects.toThrow("At least one artifact is required");
  });

  it("rejects unknown repositories the token is scoped to", async () => {
    const service = new PublishSessionService({
      state: new MemoryStateStore(),
      uploadBroker,
      clock,
      randomId,
    });

    await expect(
      service.create({
        repositoryName: "debian-internal",
        ecosystem: "apt",
        principal,
        artifacts: [artifact],
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("does not reveal whether an out-of-scope repository exists", async () => {
    const state = new MemoryStateStore();
    await state.repositories.save({
      id: "repo_other",
      name: "debian-staging",
      ecosystem: "pypi",
      visibility: "private",
      config: {},
      createdAt: "2026-07-23T00:00:00.000Z",
      updatedAt: "2026-07-23T00:00:00.000Z",
    });
    const service = new PublishSessionService({ state, uploadBroker, clock, randomId });

    // An existing out-of-scope repository and a missing one must fail the same
    // way, so the error cannot be used to enumerate repositories or ecosystems.
    for (const repositoryName of ["debian-staging", "does-not-exist"]) {
      await expect(
        service.create({ repositoryName, ecosystem: "apt", principal, artifacts: [artifact] }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});
