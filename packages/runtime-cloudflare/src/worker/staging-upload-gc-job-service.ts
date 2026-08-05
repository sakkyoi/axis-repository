import type { Clock, RepositoryObjectStore, StateStore } from "@axis-repository/core";
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

export class StagingUploadGcJobService {
  constructor(private readonly options: StagingUploadGcJobServiceOptions) {}

  async run(): Promise<StagingUploadGcRunResult> {
    const startedAt = this.options.clock.now().toISOString();
    const existing = await this.options.state.backgroundJobs.get(STAGING_UPLOAD_GC_JOB_ID);
    await this.options.state.backgroundJobs.save({
      id: STAGING_UPLOAD_GC_JOB_ID,
      type: "storage.staging-upload-gc",
      status: "running",
      subject: { type: "system", id: "staging-uploads" },
      priority: -10,
      attempts: (existing?.attempts ?? 0) + 1,
      requestedAt: startedAt,
      scheduledAt: startedAt,
      startedAt,
    });
    try {
      const discardedObjectKeys = await discardExpiredStagedUploads({
        objectStore: this.options.objectStore,
        now: this.options.clock.now(),
        sessionTtlMs: this.options.sessionTtlMs,
      });
      const finishedAt = this.options.clock.now().toISOString();
      await this.options.state.backgroundJobs.save({
        id: STAGING_UPLOAD_GC_JOB_ID,
        type: "storage.staging-upload-gc",
        status: "succeeded",
        subject: { type: "system", id: "staging-uploads" },
        priority: -10,
        attempts: (existing?.attempts ?? 0) + 1,
        requestedAt: startedAt,
        scheduledAt: startedAt,
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
        id: STAGING_UPLOAD_GC_JOB_ID,
        type: "storage.staging-upload-gc",
        status: "failed",
        subject: { type: "system", id: "staging-uploads" },
        priority: -10,
        attempts: (existing?.attempts ?? 0) + 1,
        requestedAt: startedAt,
        scheduledAt: startedAt,
        startedAt,
        finishedAt,
        failure: {
          message: error instanceof Error ? error.message : String(error),
          failedAt: finishedAt,
          retryable: true,
        },
      });
      throw error;
    }
  }
}
