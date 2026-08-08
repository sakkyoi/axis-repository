import { describe, expect, it } from "vitest";
import type { BackgroundJobRecord, BackgroundJobStatus } from "@axis-repository/core";
import { scheduleBackgroundJobs } from "./background-job-scheduler";

function job(id: string, status: BackgroundJobStatus = "pending"): BackgroundJobRecord {
  return {
    id,
    type: id,
    status,
    subject: { type: "system", id },
    priority: 0,
    attempts: 0,
    requestedAt: "2026-08-05T00:00:00.000Z",
    scheduledAt: "2026-08-05T00:00:00.000Z",
  };
}

describe("background job scheduler", () => {
  it("requests due recurring jobs and wakes the background executor", async () => {
    const calls: string[] = [];

    const result = await scheduleBackgroundJobs({
      stagingUploadGcJobService: {
        request: async (input) => {
          calls.push(`gc:${input?.deferIfRepositoryIndexActive}`);
          return job("storage.staging-upload-gc");
        },
      },
      repositoryMaintenanceJobService: {
        request: async () => {
          calls.push("maintenance");
          return job("repository.maintenance");
        },
      },
      wakeBackgroundJobs: async () => {
        calls.push("wake");
      },
    });

    expect(calls).toEqual(["gc:true", "maintenance", "wake"]);
    expect(result).toEqual({
      requestedJobIds: ["storage.staging-upload-gc", "repository.maintenance"],
      wakeRequested: true,
    });
  });

  it("does not wake the background executor when no recurring job is queued", async () => {
    const calls: string[] = [];

    const result = await scheduleBackgroundJobs({
      stagingUploadGcJobService: {
        request: async () => {
          calls.push("gc");
          return null;
        },
      },
      repositoryMaintenanceJobService: {
        request: async () => {
          calls.push("maintenance");
          return job("repository.maintenance", "succeeded");
        },
      },
      wakeBackgroundJobs: async () => {
        calls.push("wake");
      },
    });

    expect(calls).toEqual(["gc", "maintenance"]);
    expect(result).toEqual({
      requestedJobIds: [],
      wakeRequested: false,
    });
  });
});
