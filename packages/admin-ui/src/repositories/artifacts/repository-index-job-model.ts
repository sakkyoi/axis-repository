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
    return {
      label: "Refresh queued",
      description: `Requested ${formatRelativeDate(job.requestedAt)}.`,
      active: true,
      failed: false,
    };
  }
  if (job.status === "running") {
    return {
      label: "Refreshing index",
      description: `Started ${formatRelativeDate(job.startedAt ?? job.requestedAt)}.`,
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
  return {
    label: "Index refreshed",
    description: job.finishedAt ? `Finished ${formatRelativeDate(job.finishedAt)}.` : "The index is ready.",
    active: false,
    failed: false,
  };
}

function formatRelativeDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}
