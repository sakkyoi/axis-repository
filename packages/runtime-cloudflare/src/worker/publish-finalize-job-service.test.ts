import { describe, expect, it } from "vitest";
import {
  MemoryStateStore,
  PublishSessionService,
  type ArtifactPublisher,
  type Clock,
  type PublishArtifactRequest,
  type RandomId,
  type TokenPrincipal,
  type UploadBroker,
} from "@axis-repository/core";
import { PublishFinalizeJobService } from "./publish-finalize-job-service";

const clockValues = [
  "2026-08-05T00:00:00.000Z",
  "2026-08-05T00:00:01.000Z",
  "2026-08-05T00:00:02.000Z",
  "2026-08-05T00:00:03.000Z",
];

function testClock(): Clock {
  let index = 0;
  return {
    now: () => new Date(clockValues[Math.min(index++, clockValues.length - 1)]!),
  };
}

const randomId: RandomId = {
  create: (prefix: string) => `${prefix}_fixed`,
};

const principal: TokenPrincipal = {
  tokenId: "tok_1",
  name: "publisher",
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

async function readySession(state: MemoryStateStore, publisher: ArtifactPublisher) {
  await state.repositories.save({
    id: "repo_1",
    name: "debian-internal",
    ecosystem: "apt",
    kind: "hosted",
    visibility: "private",
    config: {},
    createdAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:00.000Z",
  });
  const service = new PublishSessionService({
    state,
    uploadBroker,
    artifactPublisher: publisher,
    clock: testClock(),
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
  return service;
}

describe("PublishFinalizeJobService", () => {
  it("queues a publish finalize job and marks the session finalize_queued", async () => {
    const state = new MemoryStateStore();
    const calls: unknown[] = [];
    const publishSessionService = await readySession(state, {
      publish: async (input) => {
        calls.push(input);
        return { publishedAt: "2026-08-05T00:00:00.000Z", objects: [] };
      },
    });
    const service = new PublishFinalizeJobService({
      state,
      publishSessionService,
      clock: testClock(),
    });

    await expect(service.request({ sessionId: "pub_fixed", principal })).resolves.toMatchObject({
      job: {
        id: "publish.finalize:pub_fixed",
        type: "publish.finalize",
        subject: { type: "publish-session", id: "pub_fixed", repositoryName: "debian-internal" },
        repositoryName: "debian-internal",
        status: "pending",
      },
      session: { status: "finalize_queued" },
    });

    expect(calls).toHaveLength(0);
    await expect(state.publishFinalizeJobs.listRunnable()).resolves.toMatchObject([{ sessionId: "pub_fixed" }]);
    await expect(state.backgroundJobs.get("publish.finalize:pub_fixed")).resolves.toMatchObject({
      id: "publish.finalize:pub_fixed",
      type: "publish.finalize",
      status: "pending",
      subject: { type: "publish-session", id: "pub_fixed", repositoryName: "debian-internal" },
      repositoryName: "debian-internal",
    });
  });

  it("drains queued finalize jobs and records completion", async () => {
    const state = new MemoryStateStore();
    const publishSessionService = await readySession(state, {
      publish: async (input) => ({
        publishedAt: "2026-08-05T00:00:00.000Z",
        objects: [{
          key: `repositories/${input.repository.name}/pool/main/myapp.deb`,
          contentType: "application/vnd.debian.binary-package",
        }],
      }),
    });
    const service = new PublishFinalizeJobService({
      state,
      publishSessionService,
      clock: testClock(),
    });
    await service.request({ sessionId: "pub_fixed", principal });

    await expect(service.drain({ limit: 1 })).resolves.toMatchObject({ processed: 1, failed: 0, remaining: 0 });

    await expect(state.publishFinalizeJobs.getBySession("pub_fixed")).resolves.toMatchObject({
      status: "ready",
      attempts: 1,
      finishedAt: "2026-08-05T00:00:02.000Z",
    });
    await expect(state.backgroundJobs.get("publish.finalize:pub_fixed")).resolves.toMatchObject({
      status: "succeeded",
      attempts: 1,
      finishedAt: "2026-08-05T00:00:02.000Z",
    });
    await expect(state.publishSessions.get("pub_fixed")).resolves.toMatchObject({
      status: "finalized",
      publishResult: { objects: [{ key: "repositories/debian-internal/pool/main/myapp.deb" }] },
    });
  });

  it("marks finalize jobs failed when publishing fails", async () => {
    const state = new MemoryStateStore();
    const publishSessionService = await readySession(state, {
      publish: async () => {
        throw new Error("write failed");
      },
    });
    const service = new PublishFinalizeJobService({
      state,
      publishSessionService,
      clock: testClock(),
    });
    await service.request({ sessionId: "pub_fixed", principal });

    await expect(service.drain({ limit: 1 })).resolves.toMatchObject({ processed: 1, failed: 1, remaining: 0 });

    await expect(state.publishFinalizeJobs.getBySession("pub_fixed")).resolves.toMatchObject({
      status: "failed",
      attempts: 1,
      lastFailure: { message: "write failed" },
    });
    await expect(state.backgroundJobs.get("publish.finalize:pub_fixed")).resolves.toMatchObject({
      status: "failed",
      attempts: 1,
      failure: { message: "write failed", retryable: true },
    });
    await expect(state.publishSessions.get("pub_fixed")).resolves.toMatchObject({
      status: "finalize_failed",
      failure: { message: "write failed" },
    });
  });
});
