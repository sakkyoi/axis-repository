import type { BackgroundJobRecord, BackgroundJobWakeQueue } from "@axis-repository/core";
import type { RepositoryMaintenanceJobService } from "./repository-maintenance-job-service";
import type { StagingUploadGcJobService } from "./staging-upload-gc-job-service";

export interface BackgroundJobSchedulerInput {
  stagingUploadGcJobService: Pick<StagingUploadGcJobService, "request">;
  repositoryMaintenanceJobService: Pick<RepositoryMaintenanceJobService, "request">;
  wakeQueue: BackgroundJobWakeQueue;
}

export interface BackgroundJobSchedulerResult {
  requestedJobIds: string[];
  wakeRequested: boolean;
}

export async function scheduleBackgroundJobs(
  input: BackgroundJobSchedulerInput,
): Promise<BackgroundJobSchedulerResult> {
  const requestedJobIds: string[] = [];
  const gcJob = await input.stagingUploadGcJobService.request({ deferIfRepositoryIndexActive: true });
  if (isQueuedJob(gcJob)) {
    requestedJobIds.push(gcJob.id);
  }
  const maintenanceJob = await input.repositoryMaintenanceJobService.request();
  if (isQueuedJob(maintenanceJob)) {
    requestedJobIds.push(maintenanceJob.id);
  }
  if (requestedJobIds.length > 0) {
    await input.wakeQueue.wake();
  }
  return {
    requestedJobIds,
    wakeRequested: requestedJobIds.length > 0,
  };
}

function isQueuedJob(job: Pick<BackgroundJobRecord, "id" | "status"> | null): job is BackgroundJobRecord {
  return job?.status === "pending" || job?.status === "running";
}
