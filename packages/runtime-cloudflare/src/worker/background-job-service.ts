import {
  ValidationError,
  type BackgroundJobListQuery,
  type BackgroundJobRecord,
  type Clock,
  type StateStore,
} from "@axis-repository/core";
import type { PublishFinalizeJobService } from "./publish-finalize-job-service";
import type { RepositoryIndexBackgroundJobService } from "./repository-index-background-job-service";
import type { RepositoryMaintenanceJobService } from "./repository-maintenance-job-service";
import type { StagingUploadGcJobService } from "./staging-upload-gc-job-service";
import type { RepositoryArtifactDeleteJobService } from "./repository-artifact-delete-job-service";

export interface BackgroundJobServiceOptions {
  state: StateStore;
  clock: Clock;
  repositoryIndexJobService?: Pick<RepositoryIndexBackgroundJobService, "request">;
  repositoryMaintenanceJobService?: Pick<RepositoryMaintenanceJobService, "request">;
  publishFinalizeJobService?: Pick<PublishFinalizeJobService, "requestAsAdmin">;
  stagingUploadGcJobService?: Pick<StagingUploadGcJobService, "request">;
  repositoryArtifactDeleteJobService?: Pick<RepositoryArtifactDeleteJobService, "request">;
}

export interface RequestRepositoryIndexBackgroundJobInput {
  repositoryName: string;
}

export class BackgroundJobService {
  constructor(private readonly options: BackgroundJobServiceOptions) {}

  async get(id: string): Promise<BackgroundJobRecord | null> {
    return this.options.state.backgroundJobs.get(id);
  }

  async list(query: BackgroundJobListQuery = {}): Promise<{ jobs: BackgroundJobRecord[]; total: number }> {
    return this.options.state.backgroundJobs.list(query);
  }

  async requestRepositoryIndex(input: RequestRepositoryIndexBackgroundJobInput): Promise<BackgroundJobRecord> {
    const runner = this.options.repositoryIndexJobService;
    if (!runner) {
      throw new ValidationError("Background job runner is not configured for type: repository.index");
    }
    return runner.request(input);
  }

  async cancel(id: string): Promise<BackgroundJobRecord | null> {
    return this.options.state.backgroundJobs.cancel(id, this.options.clock.now().toISOString());
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
      if (!this.options.repositoryIndexJobService) throw missingRunnerError(job);
      await this.requestRepositoryIndex({ repositoryName: job.subject.id });
      return this.options.state.backgroundJobs.get(id);
    }
    if (job.type === "repository.artifact.delete" && job.subject.type === "artifact") {
      const runner = this.options.repositoryArtifactDeleteJobService;
      if (!runner) throw missingRunnerError(job);
      const repositoryName = job.repositoryName ?? job.subject.repositoryName;
      if (!repositoryName) throw new ValidationError(`Background job is missing repository name: ${job.id}`);
      await runner.request({ repositoryName, artifactId: job.subject.id });
      return this.options.state.backgroundJobs.get(id);
    }
    if (job.type === "repository.maintenance") {
      const runner = this.options.repositoryMaintenanceJobService;
      if (!runner) throw missingRunnerError(job);
      await runner.request({ force: true });
      return this.options.state.backgroundJobs.get(id);
    }
    if (job.type === "storage.staging-upload-gc") {
      const runner = this.options.stagingUploadGcJobService;
      if (!runner) throw missingRunnerError(job);
      await runner.request({ force: true });
      return this.options.state.backgroundJobs.get(id);
    }
    throw new ValidationError(`Background job retry is not supported for type: ${job.type}`);
  }

}

function missingRunnerError(job: BackgroundJobRecord): ValidationError {
  return new ValidationError(`Background job runner is not configured for type: ${job.type}`);
}
