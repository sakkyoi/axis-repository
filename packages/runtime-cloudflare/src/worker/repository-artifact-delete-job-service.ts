import type {
  BackgroundJobRecord,
  Clock,
  RepositoryActivityService,
  RepositoryArtifactStore,
  RepositoryService,
  StateStore,
} from "@axis-repository/core";
import { NotFoundError } from "@axis-repository/core";
import type { PluginRepositoryArtifactIndexService } from "./runtime-services";

export interface RepositoryArtifactDeleteJobServiceOptions {
  state: StateStore;
  repositoryService: RepositoryService;
  repositoryArtifactStore: RepositoryArtifactStore;
  repositoryArtifactIndexService: PluginRepositoryArtifactIndexService;
  repositoryActivityService: RepositoryActivityService;
  clock: Clock;
}

export interface RequestRepositoryArtifactDeleteJobInput {
  repositoryName: string;
  artifactId: string;
}

export class RepositoryArtifactDeleteJobService {
  constructor(private readonly options: RepositoryArtifactDeleteJobServiceOptions) {}

  async request(input: RequestRepositoryArtifactDeleteJobInput): Promise<BackgroundJobRecord> {
    const repository = await this.options.repositoryService.getByName(input.repositoryName);
    const artifact = (await this.options.repositoryArtifactStore.listByRepository(repository.name))
      .find((candidate) => candidate.id === input.artifactId);
    if (!artifact) {
      throw new NotFoundError(`Repository artifact not found: ${input.artifactId}`);
    }
    const id = repositoryArtifactDeleteBackgroundJobId(repository.name, artifact.id);
    const existing = await this.options.state.backgroundJobs.get(id);
    if (existing?.status === "pending" || existing?.status === "running") {
      return existing;
    }
    const requestedAt = this.options.clock.now().toISOString();
    const job: BackgroundJobRecord = {
      id,
      type: "repository.artifact.delete",
      status: "pending",
      subject: { type: "artifact", id: artifact.id, repositoryName: repository.name },
      repositoryName: repository.name,
      priority: 0,
      attempts: existing?.attempts ?? 0,
      maxAttempts: 3,
      requestedAt,
      scheduledAt: requestedAt,
      result: {
        artifactIdentity: artifact.identity,
        artifactName: artifact.name,
        artifactSummary: artifact.summary,
        objectKeyCount: artifact.objectKeys.length,
      },
    };
    await this.options.state.backgroundJobs.save(job);
    return job;
  }

  async runBackgroundJob(job: BackgroundJobRecord): Promise<void> {
    const startedAt = this.options.clock.now().toISOString();
    const repositoryName = job.repositoryName ?? job.subject.repositoryName;
    if (!repositoryName) {
      throw new Error(`Repository artifact delete job is missing repository name: ${job.id}`);
    }
    const { finishedAt: _finishedAt, ...jobWithoutFinish } = job;
    const running: BackgroundJobRecord = {
      ...jobWithoutFinish,
      status: "running",
      attempts: job.attempts + 1,
      startedAt,
      progress: { message: "Deleting artifact" },
    };
    await this.options.state.backgroundJobs.save(running);
    try {
      const result = await this.options.repositoryArtifactIndexService.deleteArtifact({
        repositoryName,
        artifactId: job.subject.id,
      });
      await this.options.repositoryActivityService.recordArtifactDelete({
        repositoryName,
        artifactId: result.artifact.id,
        identity: result.artifact.identity,
        summary: result.artifact.summary,
        name: result.artifact.name,
        ...(result.artifact.version !== undefined ? { version: result.artifact.version } : {}),
        objectKeys: result.artifact.objectKeys,
        deletedObjectKeys: result.deletedObjectKeys,
        missingObjectKeys: result.missingObjectKeys,
        skippedObjectKeys: result.skippedObjectKeys,
        failedObjectKeys: result.failedObjectKeys,
      });
      await this.options.repositoryActivityService.recordArtifactIndexRebuild({
        repositoryName,
        artifactCount: result.artifacts.length,
      });
      const finishedAt = this.options.clock.now().toISOString();
      const { failure: _failure, ...runningWithoutFailure } = running;
      await this.options.state.backgroundJobs.save({
        ...runningWithoutFailure,
        status: "succeeded",
        finishedAt,
        progress: { message: "Deleted artifact" },
        result: {
          artifactId: result.artifact.id,
          deletedObjectCount: result.deletedObjectKeys.length,
          missingObjectCount: result.missingObjectKeys.length,
          skippedObjectCount: result.skippedObjectKeys.length,
          failedObjectCount: result.failedObjectKeys.length,
          artifactCount: result.artifacts.length,
        },
      });
    } catch (error) {
      const finishedAt = this.options.clock.now().toISOString();
      await this.options.state.backgroundJobs.save({
        ...running,
        status: "failed",
        finishedAt,
        failure: {
          message: error instanceof Error ? error.message : String(error),
          failedAt: finishedAt,
          retryable: true,
        },
      });
    }
  }
}

export function repositoryArtifactDeleteBackgroundJobId(repositoryName: string, artifactId: string): string {
  return `repository.artifact.delete:${repositoryName}:${artifactId}`;
}
