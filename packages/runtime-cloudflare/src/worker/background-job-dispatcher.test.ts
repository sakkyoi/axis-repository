import { describe, expect, it } from "vitest";
import { MemoryStateStore, type BackgroundJobRecord, type Clock } from "@axis-repository/core";
import { BackgroundJobDispatcher } from "./background-job-dispatcher";

const clock: Clock = {
  now: () => new Date("2026-08-05T00:00:00.000Z"),
};

function job(id: string, type = "test.job"): BackgroundJobRecord {
  return {
    id,
    type,
    status: "pending",
    subject: { type: "system", id },
    priority: 0,
    attempts: 0,
    requestedAt: "2026-08-05T00:00:00.000Z",
    scheduledAt: "2026-08-05T00:00:00.000Z",
  };
}

describe("BackgroundJobDispatcher", () => {
  it("dispatches runnable background jobs", async () => {
    const state = new MemoryStateStore();
    await state.backgroundJobs.save(job("queued"));
    const ran: string[] = [];
    const dispatcher = new BackgroundJobDispatcher({
      state,
      clock,
      runners: [{
        supports: (candidate) => candidate.type === "test.job",
        run: async (candidate) => {
          ran.push(candidate.id);
          await state.backgroundJobs.save({
            ...candidate,
            status: "succeeded",
            attempts: candidate.attempts + 1,
            startedAt: "2026-08-05T00:00:00.000Z",
            finishedAt: "2026-08-05T00:00:00.000Z",
          });
        },
      }],
    });

    await expect(dispatcher.drain({ limit: 1 })).resolves.toMatchObject({
      processed: 1,
      failed: 0,
      remaining: 0,
    });
    expect(ran).toEqual(["queued"]);
  });

  it("uses background job runnable ordering and reports remaining work", async () => {
    const state = new MemoryStateStore();
    await state.backgroundJobs.save({ ...job("later"), scheduledAt: "2026-08-05T00:01:00.000Z" });
    await state.backgroundJobs.save({ ...job("earlier"), scheduledAt: "2026-08-05T00:00:30.000Z" });
    const ran: string[] = [];
    const dispatcher = new BackgroundJobDispatcher({
      state,
      clock,
      runners: [{
        supports: (candidate) => candidate.type === "test.job",
        run: async (candidate) => {
          ran.push(candidate.id);
          await state.backgroundJobs.save({ ...candidate, status: "succeeded", attempts: candidate.attempts + 1 });
        },
      }],
    });

    await expect(dispatcher.drain({ limit: 1 })).resolves.toMatchObject({
      processed: 1,
      failed: 0,
      remaining: 1,
    });
    expect(ran).toEqual(["earlier"]);
  });

  it("claims a lease before running a job", async () => {
    const state = new MemoryStateStore();
    await state.backgroundJobs.save(job("queued"));
    const seen: BackgroundJobRecord[] = [];
    const dispatcher = new BackgroundJobDispatcher({
      state,
      clock,
      leaseTtlMs: 60_000,
      createLeaseId: () => "lease_fixed",
      runners: [{
        supports: (candidate) => candidate.type === "test.job",
        run: async (candidate) => {
          seen.push(candidate);
          await state.backgroundJobs.save({ ...candidate, status: "succeeded" });
        },
      }],
    });

    await dispatcher.drain({ limit: 1 });

    expect(seen).toMatchObject([{
      id: "queued",
      status: "running",
      leaseId: "lease_fixed",
      leaseExpiresAt: "2026-08-05T00:01:00.000Z",
    }]);
  });

  it("clears the lease after a runner completes the job", async () => {
    const state = new MemoryStateStore();
    await state.backgroundJobs.save(job("queued"));
    const dispatcher = new BackgroundJobDispatcher({
      state,
      clock,
      createLeaseId: () => "lease_fixed",
      runners: [{
        supports: (candidate) => candidate.type === "test.job",
        run: async (candidate) => {
          await state.backgroundJobs.save({ ...candidate, status: "succeeded", finishedAt: "2026-08-05T00:00:00.000Z" });
        },
      }],
    });

    await dispatcher.drain({ limit: 1 });

    await expect(state.backgroundJobs.get("queued")).resolves.toMatchObject({
      status: "succeeded",
    });
    const stored = await state.backgroundJobs.get("queued");
    expect(stored).not.toHaveProperty("leaseId");
    expect(stored).not.toHaveProperty("leaseExpiresAt");
  });

  it("does not run when no job can be leased", async () => {
    const state = new MemoryStateStore();
    await state.backgroundJobs.save({
      ...job("locked"),
      status: "running",
      leaseId: "other_lease",
      leaseExpiresAt: "2099-08-05T00:05:00.000Z",
    });
    const ran: string[] = [];
    const dispatcher = new BackgroundJobDispatcher({
      state,
      clock,
      createLeaseId: () => "lease_fixed",
      runners: [{
        supports: (candidate) => candidate.type === "test.job",
        run: async (candidate) => {
          ran.push(candidate.id);
        },
      }],
    });

    await expect(dispatcher.drain({ limit: 1 })).resolves.toMatchObject({
      processed: 0,
      failed: 0,
      remaining: 0,
    });
    expect(ran).toEqual([]);
  });

  it("marks jobs failed when no runner supports their type", async () => {
    const state = new MemoryStateStore();
    await state.backgroundJobs.save(job("unsupported", "unknown.job"));
    const dispatcher = new BackgroundJobDispatcher({ state, clock, runners: [] });

    await expect(dispatcher.drain({ limit: 1 })).resolves.toMatchObject({
      processed: 1,
      failed: 1,
      remaining: 0,
    });
    await expect(state.backgroundJobs.get("unsupported")).resolves.toMatchObject({
      status: "failed",
      failure: {
        message: "Background job runner is not configured for type: unknown.job",
        retryable: true,
      },
    });
  });

});
