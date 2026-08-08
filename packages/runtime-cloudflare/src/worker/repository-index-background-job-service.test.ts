import { describe, expect, it } from "vitest";
import {
  MemoryStateStore,
  RepositoryActivityService,
  RepositoryService,
  type Clock,
  type RandomId,
  type RepositoryArtifactRecord,
} from "@axis-repository/core";
import { RepositoryIndexBackgroundJobService } from "./repository-index-background-job-service";

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

describe("RepositoryIndexBackgroundJobService", () => {
  it("coalesces pending repository index background jobs by repository", async () => {
    const state = new MemoryStateStore();
    const repositoryService = new RepositoryService({ state, clock: testClock(), randomId });
    await repositoryService.create({ name: "python-proxy", ecosystem: "pypi", kind: "proxy", config: {} });
    const service = new RepositoryIndexBackgroundJobService({
      state,
      repositoryService,
      repositoryActivityService: new RepositoryActivityService({ state, clock: testClock(), randomId }),
      repositoryArtifactIndexService: { rebuild: async () => ({ artifacts: [] }) },
      clock: testClock(),
    });

    await expect(service.request({ repositoryName: "python-proxy" })).resolves.toMatchObject({
      id: "repository.index:python-proxy",
      type: "repository.index.proxy-refresh",
      status: "pending",
      attempts: 0,
      subject: { type: "repository", id: "python-proxy" },
    });
    await service.request({ repositoryName: "python-proxy" });

    await expect(state.backgroundJobs.list({ repositoryName: "python-proxy" })).resolves.toMatchObject({
      jobs: [{
        id: "repository.index:python-proxy",
        type: "repository.index.proxy-refresh",
        status: "pending",
        requestedAt: "2026-08-05T00:00:00.000Z",
      }],
      total: 1,
    });
  });

  it("runs a repository index background job, rebuilds artifacts, and records activity", async () => {
    const state = new MemoryStateStore();
    const repositoryService = new RepositoryService({ state, clock: testClock(), randomId });
    await repositoryService.create({ name: "debian-internal", ecosystem: "apt", kind: "hosted", config: {} });
    const artifact: RepositoryArtifactRecord = {
      id: "artifact_myapp",
      repositoryName: "debian-internal",
      ecosystem: "apt",
      identity: "apt:myapp:1.0.0:amd64",
      name: "myapp",
      version: "1.0.0",
      summary: "myapp 1.0.0 amd64",
      objectKeys: ["repositories/debian-internal/pool/main/m/myapp/myapp_1.0.0_amd64.deb"],
      metadata: {},
      publishedAt: "2026-08-05T00:00:00.000Z",
      updatedAt: "2026-08-05T00:00:00.000Z",
    };
    const service = new RepositoryIndexBackgroundJobService({
      state,
      repositoryService,
      repositoryActivityService: new RepositoryActivityService({ state, clock: testClock(), randomId }),
      repositoryArtifactIndexService: { rebuild: async () => ({ artifacts: [artifact] }) },
      clock: testClock(),
    });
    const job = await service.request({ repositoryName: "debian-internal" });

    await expect(service.runBackgroundJob(job)).resolves.toBeUndefined();

    await expect(state.backgroundJobs.get("repository.index:debian-internal")).resolves.toMatchObject({
      status: "succeeded",
      attempts: 1,
      finishedAt: "2026-08-05T00:00:02.000Z",
      result: { artifactCount: 1 },
    });
    await expect(state.repositoryActivities.listByRepository("debian-internal")).resolves.toMatchObject([
      {
        type: "artifact-index.rebuild",
        metadata: { artifactCount: 1 },
      },
    ]);
  });

  it("keeps incomplete repository index work pending with continuation", async () => {
    const state = new MemoryStateStore();
    const repositoryService = new RepositoryService({ state, clock: testClock(), randomId });
    await repositoryService.create({ name: "python-proxy", ecosystem: "pypi", kind: "proxy", config: {} });
    const service = new RepositoryIndexBackgroundJobService({
      state,
      repositoryService,
      repositoryActivityService: new RepositoryActivityService({ state, clock: testClock(), randomId }),
      repositoryArtifactIndexService: {
        rebuild: async () => ({
          artifacts: [],
          complete: false,
          continuation: { projectOffset: 20 },
          progress: { current: 20, total: 45, message: "Indexed 20 of 45 projects" },
        }),
      },
      clock: testClock(),
    });
    const job = await service.request({ repositoryName: "python-proxy" });

    await expect(service.runBackgroundJob(job)).resolves.toBeUndefined();

    await expect(state.backgroundJobs.get("repository.index:python-proxy")).resolves.toMatchObject({
      status: "pending",
      attempts: 1,
      startedAt: "2026-08-05T00:00:01.000Z",
      scheduledAt: "2026-08-05T00:00:02.000Z",
      lastHeartbeatAt: "2026-08-05T00:00:02.000Z",
      progress: { current: 20, total: 45, message: "Indexed 20 of 45 projects" },
      result: { continuation: { projectOffset: 20 } },
    });
    await expect(state.repositoryActivities.listByRepository("python-proxy")).resolves.toEqual([]);
  });

  it("does not count continuation slices as new attempts", async () => {
    const state = new MemoryStateStore();
    const repositoryService = new RepositoryService({ state, clock: testClock(), randomId });
    await repositoryService.create({ name: "python-proxy", ecosystem: "pypi", kind: "proxy", config: {} });
    let rebuilds = 0;
    const service = new RepositoryIndexBackgroundJobService({
      state,
      repositoryService,
      repositoryActivityService: new RepositoryActivityService({ state, clock: testClock(), randomId }),
      repositoryArtifactIndexService: {
        rebuild: async () => {
          rebuilds += 1;
          return rebuilds === 1
            ? {
              artifacts: [],
              complete: false,
              continuation: { projectOffset: 20 },
              progress: { current: 20, total: 21 },
            }
            : {
              artifacts: [],
              complete: true,
              artifactCount: 0,
            };
        },
      },
      clock: testClock(),
    });
    const job = await service.request({ repositoryName: "python-proxy" });
    await service.runBackgroundJob(job);
    const pending = await state.backgroundJobs.get("repository.index:python-proxy");
    expect(pending).toMatchObject({ status: "pending", attempts: 1 });

    await service.runBackgroundJob(pending!);

    await expect(state.backgroundJobs.get("repository.index:python-proxy")).resolves.toMatchObject({
      status: "succeeded",
      attempts: 1,
    });
  });

  it("marks failed repository index background jobs without deleting the previous artifact index", async () => {
    const state = new MemoryStateStore();
    const repositoryService = new RepositoryService({ state, clock: testClock(), randomId });
    await repositoryService.create({ name: "debian-internal", ecosystem: "apt", kind: "hosted", config: {} });
    const previousArtifact: RepositoryArtifactRecord = {
      id: "artifact_old",
      repositoryName: "debian-internal",
      ecosystem: "apt",
      identity: "apt:old:1.0.0:amd64",
      name: "old",
      version: "1.0.0",
      summary: "old 1.0.0 amd64",
      objectKeys: ["repositories/debian-internal/pool/main/o/old/old_1.0.0_amd64.deb"],
      metadata: {},
      publishedAt: "2026-08-05T00:00:00.000Z",
      updatedAt: "2026-08-05T00:00:00.000Z",
    };
    await state.repositoryArtifacts.upsert(previousArtifact);
    const service = new RepositoryIndexBackgroundJobService({
      state,
      repositoryService,
      repositoryActivityService: new RepositoryActivityService({ state, clock: testClock(), randomId }),
      repositoryArtifactIndexService: { rebuild: async () => { throw new Error("upstream unavailable"); } },
      clock: testClock(),
    });
    const job = await service.request({ repositoryName: "debian-internal" });

    await expect(service.runBackgroundJob(job)).resolves.toBeUndefined();

    await expect(state.backgroundJobs.get("repository.index:debian-internal")).resolves.toMatchObject({
      status: "failed",
      attempts: 1,
      failure: { message: "upstream unavailable", retryable: true },
    });
    await expect(state.repositoryArtifacts.listByRepository("debian-internal")).resolves.toEqual([previousArtifact]);
  });

  it("reschedules failed continuation slices for automatic retry", async () => {
    const state = new MemoryStateStore();
    const repositoryService = new RepositoryService({ state, clock: testClock(), randomId });
    await repositoryService.create({ name: "python-proxy", ecosystem: "pypi", kind: "proxy", config: {} });
    const service = new RepositoryIndexBackgroundJobService({
      state,
      repositoryService,
      repositoryActivityService: new RepositoryActivityService({ state, clock: testClock(), randomId }),
      repositoryArtifactIndexService: { rebuild: async () => { throw new Error("upstream unavailable"); } },
      clock: testClock(),
    });
    const job = await service.request({ repositoryName: "python-proxy" });
    await state.backgroundJobs.save({
      ...job,
      result: { continuation: { projectDetailOffset: 12 } },
      attempts: 1,
    });

    await service.runBackgroundJob((await state.backgroundJobs.get(job.id))!);

    await expect(state.backgroundJobs.get("repository.index:python-proxy")).resolves.toMatchObject({
      status: "pending",
      attempts: 1,
      scheduledAt: "2026-08-05T00:00:02.000Z",
      result: {
        continuation: { projectDetailOffset: 12 },
        lastFailure: { message: "upstream unavailable", retryable: true },
      },
    });
  });

  it("fails continuation slices after the automatic retry budget is exhausted", async () => {
    const state = new MemoryStateStore();
    const repositoryService = new RepositoryService({ state, clock: testClock(), randomId });
    await repositoryService.create({ name: "python-proxy", ecosystem: "pypi", kind: "proxy", config: {} });
    const service = new RepositoryIndexBackgroundJobService({
      state,
      repositoryService,
      repositoryActivityService: new RepositoryActivityService({ state, clock: testClock(), randomId }),
      repositoryArtifactIndexService: { rebuild: async () => { throw new Error("upstream unavailable"); } },
      clock: testClock(),
    });
    const job = await service.request({ repositoryName: "python-proxy" });
    await state.backgroundJobs.save({
      ...job,
      result: {
        continuation: { projectDetailOffset: 12 },
        retryCount: 3,
      },
      attempts: 1,
    });

    await service.runBackgroundJob((await state.backgroundJobs.get(job.id))!);

    await expect(state.backgroundJobs.get("repository.index:python-proxy")).resolves.toMatchObject({
      status: "failed",
      attempts: 1,
      failure: { message: "upstream unavailable", retryable: true },
    });
  });
});
