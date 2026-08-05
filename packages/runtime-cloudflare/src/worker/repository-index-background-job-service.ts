import type {
  BackgroundJobRecord,
  BackgroundJobType,
  Clock,
  Repository,
  RepositoryActivityService,
  RepositoryService,
  StateStore,
} from "@axis-repository/core";
import type { PluginRepositoryArtifactIndexService } from "./runtime-services";

export interface RepositoryIndexBackgroundJobServiceOptions {
  state: StateStore;
  repositoryService: RepositoryService;
  repositoryActivityService: RepositoryActivityService;
  repositoryArtifactIndexService: Pick<PluginRepositoryArtifactIndexService, "rebuild">;
  clock: Clock;
}

export interface RequestRepositoryIndexBackgroundJobInput {
  repositoryName: string;
}

export class RepositoryIndexBackgroundJobService {
  constructor(private readonly options: RepositoryIndexBackgroundJobServiceOptions) {}

  async request(input: RequestRepositoryIndexBackgroundJobInput): Promise<BackgroundJobRecord> {
    const repository = await this.options.repositoryService.getByName(input.repositoryName);
    const id = repositoryIndexBackgroundJobId(repository.name);
    const existing = await this.options.state.backgroundJobs.get(id);
    if (existing?.status === "pending" || existing?.status === "running") {
      return existing;
    }
    const requestedAt = this.options.clock.now().toISOString();
    const job: BackgroundJobRecord = {
      id,
      type: repositoryIndexBackgroundJobType(repository),
      status: "pending",
      subject: { type: "repository", id: repository.name, repositoryName: repository.name },
      repositoryName: repository.name,
      priority: 0,
      attempts: existing?.attempts ?? 0,
      requestedAt,
      scheduledAt: requestedAt,
      ...(existing?.failure === undefined ? {} : { failure: existing.failure }),
    };
    await this.options.state.backgroundJobs.save(job);
    return job;
  }

  async runBackgroundJob(job: BackgroundJobRecord): Promise<void> {
    const startedAt = this.options.clock.now().toISOString();
    const repositoryName = job.repositoryName ?? job.subject.repositoryName ?? job.subject.id;
    const { finishedAt: _finishedAt, ...jobWithoutFinish } = job;
    const running: BackgroundJobRecord = {
      ...jobWithoutFinish,
      status: "running",
      attempts: job.attempts + 1,
      startedAt,
    };
    await this.options.state.backgroundJobs.save(running);
    try {
      const result = await this.options.repositoryArtifactIndexService.rebuild({ repositoryName });
      const finishedAt = this.options.clock.now().toISOString();
      await this.options.repositoryActivityService.recordArtifactIndexRebuild({
        repositoryName,
        artifactCount: result.artifacts.length,
      });
      const { failure: _failure, ...runningWithoutFailure } = running;
      await this.options.state.backgroundJobs.save({
        ...runningWithoutFailure,
        status: "succeeded",
        finishedAt,
        result: { artifactCount: result.artifacts.length },
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

export function repositoryIndexBackgroundJobId(repositoryName: string): string {
  return `repository.index:${repositoryName}`;
}

function repositoryIndexBackgroundJobType(repository: Repository): BackgroundJobType {
  if (repository.kind === "proxy") return "repository.index.proxy-refresh";
  if (repository.kind === "group") return "repository.index.group-refresh";
  return "repository.index.hosted-rebuild";
}
