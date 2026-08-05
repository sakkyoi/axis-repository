import type { RepositoryIndexJob } from "../../api/schemas";

export interface RepositoryIndexJobStatusView {
  label: string;
  description: string;
  active: boolean;
  failed: boolean;
}

export function repositoryIndexJobIsActive(job: RepositoryIndexJob | null | undefined): boolean {
  return job?.status === "pending" || job?.status === "running";
}

export function repositoryIndexJobStatusView(job: RepositoryIndexJob | null | undefined): RepositoryIndexJobStatusView | null {
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
  if (job.status === "failed") {
    return {
      label: "Refresh failed",
      description: job.lastFailure?.message ?? "The last refresh failed.",
      active: false,
      failed: true,
    };
  }
  return {
    label: "Index refreshed",
    description: job.lastSuccessAt ? `Finished ${formatRelativeDate(job.lastSuccessAt)}.` : "The index is ready.",
    active: false,
    failed: false,
  };
}

function formatRelativeDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}
