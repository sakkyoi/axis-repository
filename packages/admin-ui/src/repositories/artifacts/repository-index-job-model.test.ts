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
    expect(repositoryIndexJobStatusView({ ...job, status: "canceling" })).toMatchObject({
      label: "Canceling refresh",
      active: true,
    });
    expect(repositoryIndexJobIsActive({ ...job, status: "canceling" })).toBe(true);
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
});
