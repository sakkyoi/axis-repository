import { describe, expect, it } from "vitest";
import { MemoryStateStore, RepositoryService, type Repository } from "@axis-repository/core";
import type { HostedRepositoryPlugin, RepositoryMaintenanceResult } from "../plugins/repository-plugin-contract";
import { MemoryRepositoryObjectStore } from "../storage/repository-object-store";
import { RepositoryWriteLock } from "./repository-write-lock";
import {
  REPOSITORY_MAINTENANCE_JOB_ID,
  RepositoryMaintenanceJobService,
  repositoryMaintenanceNextRunAt,
} from "./repository-maintenance-job-service";

const NOW = new Date("2026-08-05T00:00:00.000Z");

function repository(name: string): Repository {
  return {
    id: `repo_${name}`,
    name,
    ecosystem: "apt",
    kind: "hosted",
    visibility: "private",
    config: {},
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
}

function registry(run: () => Promise<RepositoryMaintenanceResult>) {
  return {
    getPluginForRepository: () => ({ kind: "hosted", maintenance: { run } }) as unknown as HostedRepositoryPlugin,
  } as never;
}

describe("RepositoryMaintenanceJobService", () => {
  it("runs repository maintenance through a background job and records the next due time", async () => {
    const state = new MemoryStateStore();
    const repositoryService = new RepositoryService({
      state,
      clock: { now: () => NOW },
      randomId: { create: (prefix) => `${prefix}_1` },
    });
    await repositoryService.create(repository("debian-internal"));
    const nextDueAt = new Date(NOW.getTime() + 60_000);
    const service = new RepositoryMaintenanceJobService({
      state,
      repositoryService,
      plugins: registry(async () => ({ refreshed: ["noble"], nextDueAt })),
      repositoryObjectStore: new MemoryRepositoryObjectStore(),
      writeLock: new RepositoryWriteLock(),
      clock: { now: () => NOW },
    });

    const job = await service.request();
    await service.runBackgroundJob(job);

    await expect(state.backgroundJobs.get(REPOSITORY_MAINTENANCE_JOB_ID)).resolves.toMatchObject({
      status: "succeeded",
      attempts: 1,
      result: {
        refreshedRepositoryCount: 1,
        failureCount: 0,
        nextRunAt: nextDueAt.toISOString(),
      },
    });
  });

  it("does not request another maintenance run before the recorded next due time", async () => {
    const state = new MemoryStateStore();
    const repositoryService = new RepositoryService({
      state,
      clock: { now: () => NOW },
      randomId: { create: (prefix) => `${prefix}_1` },
    });
    const service = new RepositoryMaintenanceJobService({
      state,
      repositoryService,
      plugins: registry(async () => ({ refreshed: [] })),
      repositoryObjectStore: new MemoryRepositoryObjectStore(),
      writeLock: new RepositoryWriteLock(),
      clock: { now: () => NOW },
    });
    await state.backgroundJobs.save({
      id: REPOSITORY_MAINTENANCE_JOB_ID,
      type: "repository.maintenance",
      status: "succeeded",
      subject: { type: "system", id: "repositories" },
      priority: -20,
      attempts: 1,
      requestedAt: NOW.toISOString(),
      scheduledAt: NOW.toISOString(),
      finishedAt: NOW.toISOString(),
      result: { nextRunAt: new Date(NOW.getTime() + 60_000).toISOString() },
    });

    const job = await service.request();

    expect(job.status).toBe("succeeded");
    expect(repositoryMaintenanceNextRunAt(job, NOW).getTime()).toBe(NOW.getTime() + 60_000);
  });
});
