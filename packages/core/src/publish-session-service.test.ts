import { describe, expect, it } from "vitest";
import {
  ForbiddenError,
  MemoryStateStore,
  NotFoundError,
  PublishSessionService,
  ValidationError,
  type Clock,
  type PublishArtifactRequest,
  type RandomId,
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

  it("verifies an uploaded object for a created session", async () => {
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
        principal,
      }),
    ).resolves.toEqual({
      uploadId: "upl_fixed",
      objectKey: "_staging/uploads/pub_fixed/upl_fixed/myapp_1.2.3_amd64.deb",
      size: 1234,
      sha256: "a".repeat(64),
    });
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
