import type { BackgroundJob } from "../api/schemas";

const jobTypeLabels: Record<string, string> = {
  "publish.finalize": "Publish finalization",
  "repository.index.hosted-rebuild": "Hosted index rebuild",
  "repository.index.proxy-refresh": "Proxy index refresh",
  "repository.index.group-refresh": "Group index refresh",
  "storage.staging-upload-gc": "Staging upload cleanup",
};

const jobStatusLabels: Record<BackgroundJob["status"], string> = {
  pending: "Queued",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  canceling: "Canceling",
  canceled: "Canceled",
};

export function backgroundJobTypeLabel(job: BackgroundJob): string {
  return jobTypeLabels[job.type] ?? job.type;
}

export function backgroundJobStatusLabel(status: BackgroundJob["status"]): string {
  return jobStatusLabels[status];
}

export function backgroundJobResultLabel(job: BackgroundJob): string {
  const lastFailure = lastFailureResult(job.result);
  if (job.status === "pending" && lastFailure) {
    return `Retrying after ${lastFailure.message}`;
  }
  if (job.failure) {
    return job.failure.message;
  }
  if (job.progress?.message) {
    return job.progress.message;
  }
  const proxyIndex = proxyIndexResult(job.result);
  if (job.status === "succeeded" && proxyIndex.failedProjectCount > 0) {
    return `Completed with ${proxyIndex.failedProjectCount} cache warning${proxyIndex.failedProjectCount === 1 ? "" : "s"}`;
  }
  if (job.status === "succeeded") {
    return "Completed";
  }
  return "-";
}

function lastFailureResult(result: Record<string, unknown> | undefined): { message: string } | null {
  const lastFailure = result?.lastFailure;
  if (!lastFailure || typeof lastFailure !== "object" || Array.isArray(lastFailure)) {
    return null;
  }
  const message = (lastFailure as Record<string, unknown>).message;
  return typeof message === "string" && message.length > 0 ? { message } : null;
}

function proxyIndexResult(result: Record<string, unknown> | undefined): { failedProjectCount: number } {
  const proxyIndex = result?.proxyIndex;
  if (!proxyIndex || typeof proxyIndex !== "object" || Array.isArray(proxyIndex)) {
    return { failedProjectCount: 0 };
  }
  const failedProjectCount = (proxyIndex as Record<string, unknown>).failedProjectCount;
  return {
    failedProjectCount: typeof failedProjectCount === "number" && Number.isFinite(failedProjectCount)
      ? failedProjectCount
      : 0,
  };
}
