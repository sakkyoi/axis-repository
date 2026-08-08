import type { BackgroundJobRecord, Clock, RepositoryObjectStore, StateStore } from "@axis-repository/core";
import { discardExpiredStagedUploads } from "./staging-sweep";

export const STAGING_UPLOAD_GC_JOB_ID = "storage.staging-upload-gc";

export interface StagingUploadGcJobServiceOptions {
  state: StateStore;
  objectStore: RepositoryObjectStore;
  clock: Clock;
  sessionTtlMs: number;
}

export interface StagingUploadGcRunResult {
  discardedObjectKeys: string[];
}

export interface StagingUploadGcRequestInput {
  force?: boolean;
  deferIfRepositoryIndexActive?: boolean;
}

export class StagingUploadGcJobService {
  constructor(private readonly options: StagingUploadGcJobServiceOptions) {}

  async request(input: StagingUploadGcRequestInput = {}): Promise<BackgroundJobRecord | null> {
    const existing = await this.options.state.backgroundJobs.get(STAGING_UPLOAD_GC_JOB_ID);
    if (existing?.status === "pending" || existing?.status === "running") {
      return existing;
    }
    if (existing?.status === "failed" && input.force !== true) {
      return existing;
    }
    if (input.deferIfRepositoryIndexActive && await this.hasActiveRepositoryIndexJob()) {
      return null;
    }
    const requestedAt = this.options.clock.now().toISOString();
    const job: BackgroundJobRecord = {
      id: STAGING_UPLOAD_GC_JOB_ID,
      type: "storage.staging-upload-gc",
      status: "pending",
      subject: { type: "system", id: "staging-uploads" },
      priority: -10,
      attempts: existing?.attempts ?? 0,
      requestedAt,
      scheduledAt: requestedAt,
    };
    await this.options.state.backgroundJobs.save(job);
    return job;
  }

  private async hasActiveRepositoryIndexJob(): Promise<boolean> {
    const pending = await this.options.state.backgroundJobs.list({ status: "pending" });
    if (pending.jobs.some((job) => job.type.startsWith("repository.index."))) {
      return true;
    }
    const running = await this.options.state.backgroundJobs.list({ status: "running" });
    return running.jobs.some((job) => job.type.startsWith("repository.index."));
  }

  async runBackgroundJob(job: BackgroundJobRecord): Promise<StagingUploadGcRunResult> {
    const startedAt = this.options.clock.now().toISOString();
    const running: BackgroundJobRecord = {
      ...job,
      status: "running",
      attempts: job.attempts + 1,
      startedAt,
    };
    await this.options.state.backgroundJobs.save(running);
    try {
      const discardedObjectKeys = await discardExpiredStagedUploads({
        objectStore: this.options.objectStore,
        now: this.options.clock.now(),
        sessionTtlMs: this.options.sessionTtlMs,
      });
      const finishedAt = this.options.clock.now().toISOString();
      await this.options.state.backgroundJobs.save({
        ...running,
        status: "succeeded",
        startedAt,
        finishedAt,
        result: {
          discardedObjectCount: discardedObjectKeys.length,
        },
      });
      return { discardedObjectKeys };
    } catch (error) {
      const finishedAt = this.options.clock.now().toISOString();
      await this.options.state.backgroundJobs.save({
        ...running,
        status: "failed",
        startedAt,
        finishedAt,
        failure: {
          message: error instanceof Error ? error.message : String(error),
          failedAt: finishedAt,
          retryable: true,
        },
      });
      return { discardedObjectKeys: [] };
    }
  }
}
