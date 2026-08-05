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
