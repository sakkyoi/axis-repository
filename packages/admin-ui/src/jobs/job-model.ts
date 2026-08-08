import type { BackgroundJob } from "../api/schemas";

const jobTypeLabels: Record<string, string> = {
  "publish.finalize": "Publish finalization",
  "repository.index.hosted-rebuild": "Hosted index rebuild",
  "repository.index.proxy-refresh": "Proxy index refresh",
  "repository.index.group-refresh": "Group index refresh",
  "repository.delete": "Repository deletion",
  "repository.proxy-cache.purge": "Proxy byte cache purge",
  "repository.artifact.delete": "Artifact deletion",
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

export function backgroundJobDetailLines(job: BackgroundJob): string[] {
  const details: string[] = [];
  const proxyIndex = proxyIndexResult(job.result);
  if (proxyIndex.phase) {
    details.push(`Phase: ${proxyIndex.phase}`);
  }
  if (proxyIndex.failedProjectSample) {
    details.push(`Sample: ${proxyIndex.failedProjectSample}`);
  }
  const nextRetryAt = nextRetryAtResult(job.result);
  if ((job.status === "pending" || job.status === "running") && nextRetryAt) {
    details.push(`Next retry: ${formatDate(nextRetryAt)}`);
  }
  if (job.lastHeartbeatAt) {
    details.push(`Heartbeat: ${formatDate(job.lastHeartbeatAt)}`);
  }
  return details;
}

function lastFailureResult(result: Record<string, unknown> | undefined): { message: string } | null {
  const lastFailure = result?.lastFailure;
  if (!lastFailure || typeof lastFailure !== "object" || Array.isArray(lastFailure)) {
    return null;
  }
  const message = (lastFailure as Record<string, unknown>).message;
  return typeof message === "string" && message.length > 0 ? { message } : null;
}

function proxyIndexResult(result: Record<string, unknown> | undefined): {
  failedProjectCount: number;
  phase?: string;
  failedProjectSample?: string;
} {
  const proxyIndex = result?.proxyIndex;
  if (!proxyIndex || typeof proxyIndex !== "object" || Array.isArray(proxyIndex)) {
    return { failedProjectCount: 0 };
  }
  const record = proxyIndex as Record<string, unknown>;
  const failedProjectCount = record.failedProjectCount;
  const phase = typeof record.phase === "string" ? record.phase : undefined;
  const failedProjects = Array.isArray(record.failedProjects) ? record.failedProjects : [];
  const first = failedProjects.find((project) =>
    project && typeof project === "object" && !Array.isArray(project)) as Record<string, unknown> | undefined;
  const project = typeof first?.project === "string" ? first.project : undefined;
  const message = typeof first?.message === "string" ? first.message : undefined;
  return {
    failedProjectCount: typeof failedProjectCount === "number" && Number.isFinite(failedProjectCount)
      ? failedProjectCount
      : 0,
    ...(phase ? { phase } : {}),
    ...(project && message ? { failedProjectSample: `${project}: ${message}` } : {}),
  };
}

function nextRetryAtResult(result: Record<string, unknown> | undefined): string | null {
  const nextRetryAt = result?.nextRetryAt;
  return typeof nextRetryAt === "string" && nextRetryAt.length > 0 ? nextRetryAt : null;
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}
