import { useState } from "react";
import { Ban, ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { useBackgroundJobs, useCancelBackgroundJob, useRetryBackgroundJob } from "../api/hooks";
import type { BackgroundJob } from "../api/schemas";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { SkeletonRows } from "../components/ui/skeleton";
import { useErrorToast } from "../components/ui/toast";
import {
  backgroundJobDetailLines,
  backgroundJobResultLabel,
  backgroundJobStatusLabel,
  backgroundJobTypeLabel,
} from "../jobs/job-model";
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
const jobsTableColumns = "grid-cols-[minmax(240px,1.25fr)_130px_minmax(240px,1fr)_190px_minmax(260px,1fr)_150px]";

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
      <div
        className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center gap-2 bg-background/95 px-1 py-1 backdrop-blur"
        aria-label="Job status filters"
      >
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
          <div className="overflow-x-auto rounded-md border border-border" data-testid="jobs-table-scroll-area">
            <div className="min-w-[82rem]" role="table" aria-label="Background jobs">
              <div
                className={`grid ${jobsTableColumns} gap-3 border-b border-border bg-muted px-3 py-2 text-xs font-semibold uppercase text-muted-foreground`}
                role="row"
              >
                <span role="columnheader">Job</span>
                <span role="columnheader">Status</span>
                <span role="columnheader">Subject</span>
                <span role="columnheader">Requested</span>
                <span className="min-w-0" role="columnheader">Result</span>
                <span className="text-right" role="columnheader">Actions</span>
              </div>
              <div className="divide-y divide-border" role="rowgroup">
                {jobs.data.jobs.map((job) => (
                  <div
                    key={job.id}
                    className={`grid ${jobsTableColumns} gap-3 px-3 py-3 text-sm`}
                    role="row"
                  >
                    <div className="min-w-0" role="cell">
                      <div className="truncate font-medium">{backgroundJobTypeLabel(job)}</div>
                      <div className="mt-1 truncate font-mono text-xs text-muted-foreground">{job.id}</div>
                    </div>
                    <div role="cell">
                      <Badge variant={statusVariant[job.status]}>{backgroundJobStatusLabel(job.status)}</Badge>
                      {job.attempts > 0 && (
                        <div className="mt-2 text-xs text-muted-foreground">{job.attempts} attempt{job.attempts === 1 ? "" : "s"}</div>
                      )}
                    </div>
                    <div className="min-w-0" role="cell">
                      <div className="truncate">{job.subject.id}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{job.subject.type}</div>
                      {job.repositoryName && (
                        <div className="mt-1 truncate font-mono text-xs text-muted-foreground">{job.repositoryName}</div>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground" role="cell">
                      <div>{new Date(job.requestedAt).toLocaleString()}</div>
                      {job.finishedAt && <div className="mt-1">Done {new Date(job.finishedAt).toLocaleString()}</div>}
                    </div>
                    <div className="min-w-0 break-words text-xs text-muted-foreground" role="cell">
                      {job.failure ? (
                        <span className="text-destructive">{job.failure.message}</span>
                      ) : (
                        backgroundJobResultLabel(job)
                      )}
                      {backgroundJobDetailLines(job).map((line) => (
                        <div key={line} className="mt-1 break-words text-[11px] text-muted-foreground">{line}</div>
                      ))}
                    </div>
                    <div className="flex flex-wrap justify-end gap-2" role="cell">
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
