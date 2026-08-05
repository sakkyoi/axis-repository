import { describe, expect, it } from "vitest";
import type { BackgroundJob } from "../api/schemas";
import { backgroundJobStatusLabel, backgroundJobTypeLabel } from "./job-model";

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
});
