import { describe, expect, it } from "vitest";
import { repositoryIndexJobStatusView } from "./repository-index-job-model";
import type { RepositoryIndexJob } from "../../api/schemas";

describe("repositoryIndexJobStatusView", () => {
  it("shows queued and running jobs as in progress", () => {
    const job: RepositoryIndexJob = {
      repositoryName: "python-proxy",
      kind: "proxy-refresh",
      status: "pending",
      requestedAt: "2026-08-05T00:00:00.000Z",
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
  });

  it("surfaces the latest job failure message", () => {
    expect(repositoryIndexJobStatusView({
      repositoryName: "python-proxy",
      kind: "proxy-refresh",
      status: "failed",
      requestedAt: "2026-08-05T00:00:00.000Z",
      attempts: 1,
      lastFailure: {
        message: "upstream unavailable",
        failedAt: "2026-08-05T00:00:10.000Z",
      },
    })).toMatchObject({
      label: "Refresh failed",
      active: false,
      description: "upstream unavailable",
    });
  });
});
