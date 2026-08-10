import type { BackgroundJob } from "../../api/schemas";

export interface RepositoryIndexJobStatusView {
  label: string;
  description: string;
  active: boolean;
  failed: boolean;
}

export function repositoryIndexJobIsActive(job: BackgroundJob | null | undefined): boolean {
  return job?.status === "pending" || job?.status === "running" || job?.status === "canceling";
}

export function repositoryIndexJobStatusView(job: BackgroundJob | null | undefined): RepositoryIndexJobStatusView | null {
  if (!job) return null;
  if (job.status === "pending") {
    const retry = retryResult(job.result);
    if (retry) {
      return {
        label: "Retrying refresh",
        description: `Retrying after ${retry.message}. Next attempt ${formatRelativeDate(job.scheduledAt)}.`,
        active: true,
        failed: false,
      };
    }
    return {
      label: "Refresh queued",
      description: job.progress?.message ?? `Requested ${formatRelativeDate(job.requestedAt)}.`,
      active: true,
      failed: false,
    };
  }
  if (job.status === "running") {
    return {
      label: "Refreshing index",
      description: job.progress?.message ?? `Started ${formatRelativeDate(job.startedAt ?? job.requestedAt)}.`,
      active: true,
      failed: false,
    };
  }
  if (job.status === "canceling") {
    return {
      label: "Canceling refresh",
      description: "The refresh will stop after the current step.",
      active: true,
      failed: false,
    };
  }
  if (job.status === "canceled") {
    return {
      label: "Refresh canceled",
      description: job.finishedAt ? `Stopped ${formatRelativeDate(job.finishedAt)}.` : "The refresh was canceled.",
      active: false,
      failed: false,
    };
  }
  if (job.status === "failed") {
    return {
      label: "Refresh failed",
      description: job.failure?.message ?? "The last refresh failed.",
      active: false,
      failed: true,
    };
  }
  const proxyIndex = proxyIndexResult(job.result);
  if (proxyIndex.failedProjectCount > 0) {
    return {
      label: "Catalog ready with cache warnings",
      description: proxyIndex.failedProjectSample
        ? `${proxyIndex.failedProjectCount} project detail caches failed. ${proxyIndex.failedProjectSample}`
        : `${proxyIndex.failedProjectCount} project detail caches failed.`,
      active: false,
      failed: false,
    };
  }
  return {
    label: "Index refreshed",
    description: job.finishedAt ? `Finished ${formatRelativeDate(job.finishedAt)}.` : "The index is ready.",
    active: false,
    failed: false,
  };
}

function proxyIndexResult(result: Record<string, unknown> | undefined): {
  failedProjectCount: number;
  failedProjectSample?: string;
} {
  const proxyIndex = result?.proxyIndex;
  if (!proxyIndex || typeof proxyIndex !== "object" || Array.isArray(proxyIndex)) {
    return { failedProjectCount: 0 };
  }
  const record = proxyIndex as Record<string, unknown>;
  const failedProjectCount = typeof record.failedProjectCount === "number" ? record.failedProjectCount : 0;
  const failedProjects = Array.isArray(record.failedProjects) ? record.failedProjects : [];
  const first = failedProjects.find((project) =>
    project && typeof project === "object" && !Array.isArray(project)) as Record<string, unknown> | undefined;
  const project = typeof first?.project === "string" ? first.project : undefined;
  const message = typeof first?.message === "string" ? first.message : undefined;
  return {
    failedProjectCount,
    ...(project && message ? { failedProjectSample: `${project}: ${message}` } : {}),
  };
}

function retryResult(result: Record<string, unknown> | undefined): { message: string } | null {
  const lastFailure = result?.lastFailure;
  if (!lastFailure || typeof lastFailure !== "object" || Array.isArray(lastFailure)) {
    return null;
  }
  const message = (lastFailure as Record<string, unknown>).message;
  return typeof message === "string" && message.length > 0 ? { message } : null;
}

function formatRelativeDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}
