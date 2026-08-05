import { Ban } from "lucide-react";
import { useBackgroundJobs, useCancelBackgroundJob } from "../api/hooks";
import type { BackgroundJob } from "../api/schemas";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { SkeletonRows } from "../components/ui/skeleton";
import { useErrorToast } from "../components/ui/toast";
import { ErrorState, PageShell } from "./shared";

const statusVariant: Record<BackgroundJob["status"], "default" | "success" | "warning" | "destructive"> = {
  pending: "warning",
  running: "default",
  succeeded: "success",
  failed: "destructive",
  canceling: "warning",
  canceled: "default",
};

export function JobsPage() {
  const jobs = useBackgroundJobs({ limit: 50 });
  const cancelJob = useCancelBackgroundJob();
  useErrorToast("Job cancellation failed", cancelJob.error);

  return (
    <PageShell
      title="Jobs"
      description="Background work running outside request lifetimes."
    >
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
        <div className="overflow-x-auto rounded-md border border-border">
          <div className="min-w-[980px]">
            <div className="grid grid-cols-[minmax(220px,1.2fr)_120px_minmax(220px,1fr)_180px_minmax(220px,1fr)_120px] border-b border-border bg-muted px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
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
                  className="grid grid-cols-[minmax(220px,1.2fr)_120px_minmax(220px,1fr)_180px_minmax(220px,1fr)_120px] gap-3 px-3 py-3 text-sm"
                >
                  <div className="min-w-0">
                    <div className="truncate font-mono text-xs">{job.id}</div>
                    <div className="mt-1 text-muted-foreground">{job.type}</div>
                  </div>
                  <div>
                    <Badge variant={statusVariant[job.status]}>{job.status}</Badge>
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
                  <div>
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
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
