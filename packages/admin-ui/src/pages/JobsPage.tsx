import { useState } from "react";
import { Ban, ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { useBackgroundJobs, useCancelBackgroundJob, useRetryBackgroundJob } from "../api/hooks";
import type { BackgroundJob } from "../api/schemas";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { SkeletonRows } from "../components/ui/skeleton";
import { useErrorToast } from "../components/ui/toast";
import { backgroundJobStatusLabel, backgroundJobTypeLabel } from "../jobs/job-model";
import { ErrorState, PageShell } from "./shared";

const statusVariant: Record<BackgroundJob["status"], "default" | "success" | "warning" | "destructive"> = {
  pending: "warning",
  running: "default",
  succeeded: "success",
  failed: "destructive",
  canceling: "warning",
  canceled: "default",
};

const JOB_PAGE_LIMIT = 50;
type JobStatusFilter = "all" | BackgroundJob["status"];

const statusFilters: Array<{ value: JobStatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "pending", label: "Queued" },
  { value: "running", label: "Running" },
  { value: "failed", label: "Failed" },
  { value: "succeeded", label: "Succeeded" },
  { value: "canceled", label: "Canceled" },
];

export function JobsPage() {
  const [offset, setOffset] = useState(0);
  const [statusFilter, setStatusFilter] = useState<JobStatusFilter>("all");
  const jobs = useBackgroundJobs({
    limit: JOB_PAGE_LIMIT,
    offset,
    ...(statusFilter === "all" ? {} : { status: statusFilter }),
  });
  const cancelJob = useCancelBackgroundJob();
  const retryJob = useRetryBackgroundJob();
  useErrorToast("Job cancellation failed", cancelJob.error);
  useErrorToast("Job retry failed", retryJob.error);
  const totalJobs = jobs.data?.total ?? 0;
  const shownJobs = jobs.data?.jobs.length ?? 0;
  const rangeStart = totalJobs === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + shownJobs, totalJobs);
  const canGoPrevious = offset > 0;
  const canGoNext = offset + shownJobs < totalJobs;

  return (
    <PageShell
      title="Jobs"
      description="Background work running outside request lifetimes."
    >
      <div className="flex flex-wrap items-center gap-2" aria-label="Job status filters">
        {statusFilters.map((filter) => (
          <Button
            key={filter.value}
            type="button"
            size="sm"
            variant={statusFilter === filter.value ? "default" : "outline"}
            aria-pressed={statusFilter === filter.value}
            onClick={() => {
              setStatusFilter(filter.value);
              setOffset(0);
            }}
          >
            {filter.label}
          </Button>
        ))}
      </div>
      {jobs.isLoading && (
        <div className="rounded-md border border-border">
          <SkeletonRows rows={5} columns={["w-44", "w-28", "w-52", "w-32", "w-24"]} />
        </div>
      )}
      {jobs.error && <ErrorState title="Jobs unavailable" error={jobs.error} />}
      {jobs.data && jobs.data.jobs.length === 0 && (
        <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          No background jobs have been recorded.
        </div>
      )}
      {jobs.data && jobs.data.jobs.length > 0 && (
        <div className="grid gap-3">
          <div className="overflow-x-auto rounded-md border border-border">
            <div className="min-w-[980px]">
              <div className="grid grid-cols-[minmax(220px,1.2fr)_120px_minmax(220px,1fr)_180px_minmax(220px,1fr)_160px] border-b border-border bg-muted px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
                <span>Job</span>
                <span>Status</span>
                <span>Subject</span>
                <span>Requested</span>
                <span>Result</span>
                <span>Actions</span>
              </div>
              <div className="divide-y divide-border">
                {jobs.data.jobs.map((job) => (
                  <div
                    key={job.id}
                    className="grid grid-cols-[minmax(220px,1.2fr)_120px_minmax(220px,1fr)_180px_minmax(220px,1fr)_160px] gap-3 px-3 py-3 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{backgroundJobTypeLabel(job)}</div>
                      <div className="mt-1 truncate font-mono text-xs text-muted-foreground">{job.id}</div>
                    </div>
                    <div>
                      <Badge variant={statusVariant[job.status]}>{backgroundJobStatusLabel(job.status)}</Badge>
                      {job.attempts > 0 && (
                        <div className="mt-2 text-xs text-muted-foreground">{job.attempts} attempt{job.attempts === 1 ? "" : "s"}</div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate">{job.subject.id}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{job.subject.type}</div>
                      {job.repositoryName && (
                        <div className="mt-1 truncate font-mono text-xs text-muted-foreground">{job.repositoryName}</div>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <div>{new Date(job.requestedAt).toLocaleString()}</div>
                      {job.finishedAt && <div className="mt-1">Done {new Date(job.finishedAt).toLocaleString()}</div>}
                    </div>
                    <div className="min-w-0 text-xs text-muted-foreground">
                      {job.failure ? (
                        <span className="text-destructive">{job.failure.message}</span>
                      ) : job.progress?.message ? (
                        job.progress.message
                      ) : job.status === "succeeded" ? (
                        "Completed"
                      ) : (
                        "-"
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(job.status === "pending" || job.status === "running") && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={cancelJob.isPending}
                          onClick={() => cancelJob.mutate(job.id)}
                        >
                          <Ban className="mr-1.5 size-3.5" aria-hidden="true" />
                          Cancel
                        </Button>
                      )}
                      {(job.status === "failed" || job.status === "canceled") && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={retryJob.isPending}
                          onClick={() => retryJob.mutate(job.id)}
                        >
                          <RotateCcw className="mr-1.5 size-3.5" aria-hidden="true" />
                          Retry
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
            <span>Showing {rangeStart}-{rangeEnd} of {totalJobs}</span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!canGoPrevious || jobs.isFetching}
                onClick={() => setOffset(Math.max(0, offset - JOB_PAGE_LIMIT))}
              >
                <ChevronLeft className="mr-1.5 size-3.5" aria-hidden="true" />
                Previous page
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!canGoNext || jobs.isFetching}
                onClick={() => setOffset(offset + JOB_PAGE_LIMIT)}
              >
                Next page
                <ChevronRight className="ml-1.5 size-3.5" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
