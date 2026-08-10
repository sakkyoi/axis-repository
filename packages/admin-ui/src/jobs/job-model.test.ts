import { describe, expect, it } from "vitest";
import type { BackgroundJob } from "../api/schemas";
import {
  backgroundJobDetailLines,
  backgroundJobResultLabel,
  backgroundJobStatusLabel,
  backgroundJobTypeLabel,
} from "./job-model";

const job: BackgroundJob = {
  id: "repository.index:python-proxy",
  type: "repository.index.proxy-refresh",
  status: "pending",
  subject: { type: "repository", id: "python-proxy", repositoryName: "python-proxy" },
  repositoryName: "python-proxy",
  priority: 0,
  attempts: 0,
  requestedAt: "2026-08-05T00:00:00.000Z",
  scheduledAt: "2026-08-05T00:00:00.000Z",
};

describe("background job display model", () => {
  it("names known background job types for operators", () => {
    expect(backgroundJobTypeLabel(job)).toBe("Proxy index refresh");
    expect(backgroundJobTypeLabel({ ...job, type: "repository.index.hosted-rebuild" })).toBe("Hosted index rebuild");
    expect(backgroundJobTypeLabel({ ...job, type: "repository.index.group-refresh" })).toBe("Group index refresh");
    expect(backgroundJobTypeLabel({
      ...job,
      id: "publish.finalize:pub_1",
      type: "publish.finalize",
      subject: { type: "publish-session", id: "pub_1", repositoryName: "python-proxy" },
    })).toBe("Publish finalization");
    expect(backgroundJobTypeLabel({
      ...job,
      id: "storage.staging-upload-gc",
      type: "storage.staging-upload-gc",
      subject: { type: "system", id: "storage" },
      repositoryName: undefined,
    })).toBe("Staging upload cleanup");
  });

  it("keeps unknown job types readable without hiding the contract value", () => {
    expect(backgroundJobTypeLabel({ ...job, type: "custom.work" })).toBe("custom.work");
  });

  it("formats job status labels consistently", () => {
    expect(backgroundJobStatusLabel("pending")).toBe("Queued");
    expect(backgroundJobStatusLabel("running")).toBe("Running");
    expect(backgroundJobStatusLabel("succeeded")).toBe("Succeeded");
    expect(backgroundJobStatusLabel("failed")).toBe("Failed");
    expect(backgroundJobStatusLabel("canceling")).toBe("Canceling");
    expect(backgroundJobStatusLabel("canceled")).toBe("Canceled");
  });

  it("formats result text from progress, retries, partial warnings, and terminal states", () => {
    expect(backgroundJobResultLabel({
      ...job,
      attempts: 1,
      scheduledAt: "2026-08-05T00:00:32.000Z",
      result: {
        lastFailure: {
          message: "upstream unavailable",
          failedAt: "2026-08-05T00:00:02.000Z",
          retryable: true,
        },
      },
    })).toBe("Retrying after upstream unavailable");
    expect(backgroundJobResultLabel({
      ...job,
      status: "running",
      progress: { current: 10, total: 20, message: "Warmed project details 10 of 20" },
    })).toBe("Warmed project details 10 of 20");
    expect(backgroundJobResultLabel({
      ...job,
      status: "succeeded",
      result: {
        proxyIndex: {
          failedProjectCount: 2,
          failedProjects: [{ project: "broken", message: "upstream returned 503", retryable: true }],
        },
      },
    })).toBe("Catalog ready with 2 project cache warnings");
    expect(backgroundJobResultLabel({ ...job, status: "succeeded" })).toBe("Completed");
  });

  it("formats operational detail lines for retries, heartbeats, and proxy partial failures", () => {
    expect(backgroundJobDetailLines({
      ...job,
      status: "pending",
      lastHeartbeatAt: "2026-08-05T00:00:02.000Z",
      result: {
        nextRetryAt: "2026-08-05T00:00:32.000Z",
        proxyIndex: {
          phase: "warming-project-details",
          failedProjectCount: 1,
          failedProjects: [{ project: "broken", message: "upstream returned 503", retryable: true }],
        },
      },
    })).toEqual([
      "Phase: warming-project-details",
      "Sample: broken: upstream returned 503",
      expect.stringContaining("Next retry:"),
      expect.stringContaining("Heartbeat:"),
    ]);
  });
});
