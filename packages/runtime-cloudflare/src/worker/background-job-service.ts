import {
  ValidationError,
  type BackgroundJobListQuery,
  type BackgroundJobRecord,
  type Clock,
  type StateStore,
} from "@axis-repository/core";
import type { PublishFinalizeJobService } from "./publish-finalize-job-service";
import type { RepositoryIndexJobService } from "./repository-index-job-service";
import type { StagingUploadGcJobService } from "./staging-upload-gc-job-service";

export interface BackgroundJobServiceOptions {
  state: StateStore;
  clock: Clock;
  repositoryIndexJobService?: Pick<RepositoryIndexJobService, "request">;
  publishFinalizeJobService?: Pick<PublishFinalizeJobService, "requestAsAdmin">;
  stagingUploadGcJobService?: Pick<StagingUploadGcJobService, "run">;
}

export class BackgroundJobService {
  constructor(private readonly options: BackgroundJobServiceOptions) {}

  async get(id: string): Promise<BackgroundJobRecord | null> {
    return this.options.state.backgroundJobs.get(id);
  }

  async list(query: BackgroundJobListQuery = {}): Promise<{ jobs: BackgroundJobRecord[]; total: number }> {
    return this.options.state.backgroundJobs.list(query);
  }

  async cancel(id: string): Promise<BackgroundJobRecord | null> {
    const canceled = await this.options.state.backgroundJobs.cancel(id, this.options.clock.now().toISOString());
    if (!canceled) return null;
    if (canceled.status === "canceled") {
      await this.cancelLegacyPendingJob(canceled);
    }
    return canceled;
  }

  async retry(id: string): Promise<BackgroundJobRecord | null> {
    const job = await this.options.state.backgroundJobs.get(id);
    if (!job) return null;
    if (job.status !== "failed" && job.status !== "canceled") {
      throw new ValidationError(`Background job cannot be retried from status: ${job.status}`);
    }
    if (job.type === "publish.finalize" && job.subject.type === "publish-session") {
      const runner = this.options.publishFinalizeJobService;
      if (!runner) throw missingRunnerError(job);
      await runner.requestAsAdmin({ sessionId: job.subject.id });
      return this.options.state.backgroundJobs.get(id);
    }
    if (job.type.startsWith("repository.index.") && job.subject.type === "repository") {
      const runner = this.options.repositoryIndexJobService;
      if (!runner) throw missingRunnerError(job);
      await runner.request({ repositoryName: job.subject.id });
      return this.options.state.backgroundJobs.get(id);
    }
    if (job.type === "storage.staging-upload-gc") {
      const runner = this.options.stagingUploadGcJobService;
      if (!runner) throw missingRunnerError(job);
      await runner.run();
      return this.options.state.backgroundJobs.get(id);
    }
    throw new ValidationError(`Background job retry is not supported for type: ${job.type}`);
  }

  private async cancelLegacyPendingJob(job: BackgroundJobRecord): Promise<void> {
    if (job.type === "publish.finalize" && job.subject.type === "publish-session") {
      await this.options.state.publishFinalizeJobs.deleteBySession(job.subject.id);
      return;
    }
    if (job.type.startsWith("repository.index.") && job.subject.type === "repository") {
      await this.options.state.repositoryIndexJobs.deleteByRepository(job.subject.id);
    }
  }
}

function missingRunnerError(job: BackgroundJobRecord): ValidationError {
  return new ValidationError(`Background job runner is not configured for type: ${job.type}`);
}
