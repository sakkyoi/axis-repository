import { describe, expect, it } from "vitest";
import { repositoryIndexJobIsActive, repositoryIndexJobStatusView } from "./repository-index-job-model";
import type { BackgroundJob } from "../../api/schemas";

describe("repositoryIndexJobStatusView", () => {
  it("shows queued and running jobs as in progress", () => {
    const job: BackgroundJob = {
      id: "repository.index:python-proxy",
      type: "repository.index.proxy-refresh",
      status: "pending",
      subject: { type: "repository", id: "python-proxy", repositoryName: "python-proxy" },
      repositoryName: "python-proxy",
      priority: 0,
      requestedAt: "2026-08-05T00:00:00.000Z",
      scheduledAt: "2026-08-05T00:00:00.000Z",
      attempts: 0,
    };

    expect(repositoryIndexJobStatusView(job)).toMatchObject({
      label: "Refresh queued",
      active: true,
    });
    expect(repositoryIndexJobStatusView({ ...job, status: "running", attempts: 1 })).toMatchObject({
      label: "Refreshing index",
      active: true,
    });
    expect(repositoryIndexJobStatusView({
      ...job,
      status: "running",
      attempts: 1,
      progress: { current: 150, total: 200, message: "Warmed project details 50 of 100" },
    })).toMatchObject({
      label: "Refreshing index",
      description: "Warmed project details 50 of 100",
      active: true,
    });
    expect(repositoryIndexJobStatusView({ ...job, status: "canceling" })).toMatchObject({
      label: "Canceling refresh",
      active: true,
    });
    expect(repositoryIndexJobIsActive({ ...job, status: "canceling" })).toBe(true);
  });

  it("shows retry context for queued continuation retries", () => {
    expect(repositoryIndexJobStatusView({
      id: "repository.index:python-proxy",
      type: "repository.index.proxy-refresh",
      status: "pending",
      subject: { type: "repository", id: "python-proxy", repositoryName: "python-proxy" },
      repositoryName: "python-proxy",
      priority: 0,
      requestedAt: "2026-08-05T00:00:00.000Z",
      scheduledAt: "2026-08-05T00:00:32.000Z",
      attempts: 1,
      result: {
        retryCount: 1,
        lastFailure: {
          message: "upstream unavailable",
          failedAt: "2026-08-05T00:00:02.000Z",
          retryable: true,
        },
      },
    })).toMatchObject({
      label: "Retrying refresh",
      description: expect.stringContaining("upstream unavailable"),
      active: true,
      failed: false,
    });
  });

  it("shows canceled jobs without claiming the index refreshed", () => {
    expect(repositoryIndexJobStatusView({
      id: "repository.index:python-proxy",
      type: "repository.index.proxy-refresh",
      status: "canceled",
      subject: { type: "repository", id: "python-proxy", repositoryName: "python-proxy" },
      repositoryName: "python-proxy",
      priority: 0,
      requestedAt: "2026-08-05T00:00:00.000Z",
      scheduledAt: "2026-08-05T00:00:00.000Z",
      attempts: 0,
      finishedAt: "2026-08-05T00:00:10.000Z",
    })).toMatchObject({
      label: "Refresh canceled",
      active: false,
      failed: false,
    });
  });

  it("surfaces the latest job failure message", () => {
    expect(repositoryIndexJobStatusView({
      id: "repository.index:python-proxy",
      type: "repository.index.proxy-refresh",
      status: "failed",
      subject: { type: "repository", id: "python-proxy", repositoryName: "python-proxy" },
      repositoryName: "python-proxy",
      priority: 0,
      requestedAt: "2026-08-05T00:00:00.000Z",
      scheduledAt: "2026-08-05T00:00:00.000Z",
      attempts: 1,
      failure: {
        message: "upstream unavailable",
        failedAt: "2026-08-05T00:00:10.000Z",
        retryable: true,
      },
    })).toMatchObject({
      label: "Refresh failed",
      active: false,
      description: "upstream unavailable",
    });
  });

  it("surfaces partial proxy index failures from succeeded jobs", () => {
    expect(repositoryIndexJobStatusView({
      id: "repository.index:python-proxy",
      type: "repository.index.proxy-refresh",
      status: "succeeded",
      subject: { type: "repository", id: "python-proxy", repositoryName: "python-proxy" },
      repositoryName: "python-proxy",
      priority: 0,
      requestedAt: "2026-08-05T00:00:00.000Z",
      scheduledAt: "2026-08-05T00:00:00.000Z",
      attempts: 1,
      finishedAt: "2026-08-05T00:00:10.000Z",
      result: {
        proxyIndex: {
          phase: "complete-with-failures",
          failedProjectCount: 2,
          failedProjects: [{ project: "broken", message: "upstream returned 503", retryable: true }],
        },
      },
    })).toMatchObject({
      label: "Index refreshed with warnings",
      description: "2 projects failed to cache. broken: upstream returned 503",
      active: false,
      failed: false,
    });
  });
});
