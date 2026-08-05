import { describe, expect, it } from "vitest";
import { MemoryStateStore, type BackgroundJobRecord, type Clock } from "@axis-repository/core";
import { BackgroundJobService } from "./background-job-service";

const clock: Clock = {
  now: () => new Date("2026-08-05T00:00:00.000Z"),
};

const baseJob: BackgroundJobRecord = {
  id: "repository.index:python-proxy",
  type: "repository.index.proxy-refresh",
  status: "canceled",
  subject: { type: "repository", id: "python-proxy", repositoryName: "python-proxy" },
  repositoryName: "python-proxy",
  priority: 0,
  attempts: 1,
  requestedAt: "2026-08-05T00:00:00.000Z",
  scheduledAt: "2026-08-05T00:00:00.000Z",
  finishedAt: "2026-08-05T00:00:01.000Z",
};

describe("BackgroundJobService", () => {
  it("requests repository index work through the generic job service", async () => {
    const state = new MemoryStateStore();
    const service = new BackgroundJobService({
      state,
      clock,
      repositoryIndexJobService: {
        request: async ({ repositoryName }) => {
          const job: BackgroundJobRecord = {
            ...baseJob,
            id: `repository.index:${repositoryName}`,
            subject: { type: "repository", id: repositoryName, repositoryName },
            repositoryName,
            status: "pending",
            attempts: 0,
          };
          await state.backgroundJobs.save(job);
          return job;
        },
      },
    });

    await expect(service.requestRepositoryIndex({ repositoryName: "python-proxy" })).resolves.toMatchObject({
      id: "repository.index:python-proxy",
      type: "repository.index.proxy-refresh",
      status: "pending",
      subject: { type: "repository", id: "python-proxy" },
    });
  });

  it("fails retry explicitly when a repository index runner is not configured", async () => {
    const state = new MemoryStateStore();
    await state.backgroundJobs.save(baseJob);
    const service = new BackgroundJobService({ state, clock });

    await expect(service.retry(baseJob.id)).rejects.toThrow(
      "Background job runner is not configured for type: repository.index.proxy-refresh",
    );
  });

  it("fails retry explicitly when a publish finalize runner is not configured", async () => {
    const state = new MemoryStateStore();
    await state.backgroundJobs.save({
      ...baseJob,
      id: "publish.finalize:pub_1",
      type: "publish.finalize",
      subject: { type: "publish-session", id: "pub_1", repositoryName: "python-proxy" },
    });
    const service = new BackgroundJobService({ state, clock });

    await expect(service.retry("publish.finalize:pub_1")).rejects.toThrow(
      "Background job runner is not configured for type: publish.finalize",
    );
  });

  it("fails retry explicitly when the staging upload cleanup runner is not configured", async () => {
    const state = new MemoryStateStore();
    const { repositoryName: _repositoryName, ...systemJob } = baseJob;
    await state.backgroundJobs.save({
      ...systemJob,
      id: "storage.staging-upload-gc",
      type: "storage.staging-upload-gc",
      subject: { type: "system", id: "storage" },
    });
    const service = new BackgroundJobService({ state, clock });

    await expect(service.retry("storage.staging-upload-gc")).rejects.toThrow(
      "Background job runner is not configured for type: storage.staging-upload-gc",
    );
  });
});
