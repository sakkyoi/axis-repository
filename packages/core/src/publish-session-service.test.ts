import { describe, expect, it } from "vitest";
import {
  ForbiddenError,
  MemoryStateStore,
  NotFoundError,
  PublishSessionService,
  type Clock,
  type RandomId,
  type TokenPrincipal,
  type UploadBroker,
} from "./index";

const clock: Clock = {
  now: () => new Date("2026-07-12T00:00:00.000Z"),
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

const uploadBroker: UploadBroker = {
  createUploadTarget: async ({ sessionId, uploadId, artifact, expiresAt }) => ({
    uploadId,
    filename: artifact.filename,
    objectKey: `_staging/uploads/${sessionId}/${uploadId}/${artifact.filename}`,
    method: "PUT",
    url: `https://uploads.example/${uploadId}`,
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

describe("PublishSessionService", () => {
  it("creates a publish session with upload targets", async () => {
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
    const service = new PublishSessionService({ state, uploadBroker, clock, randomId });

    const session = await service.create({
      repositoryName: "debian-internal",
      ecosystem: "apt",
      principal,
      artifacts: [
        {
          filename: "myapp_1.2.3_amd64.deb",
          size: 1234,
          sha256: "a".repeat(64),
          contentType: "application/vnd.debian.binary-package",
          metadata: {},
        },
      ],
    });

    expect(session.id).toBe("pub_fixed");
    expect(session.uploads).toHaveLength(1);
    expect(session.uploads[0]?.url).toBe("https://uploads.example/upl_fixed");
    expect(await state.publishSessions.get("pub_fixed")).toEqual(session);
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
