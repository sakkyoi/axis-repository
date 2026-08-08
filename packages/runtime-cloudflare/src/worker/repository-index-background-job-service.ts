import type {
  BackgroundJobRecord,
  BackgroundJobProgress,
  BackgroundJobType,
  Clock,
  Repository,
  RepositoryActivityService,
  RepositoryService,
  StateStore,
} from "@axis-repository/core";
interface RepositoryIndexRebuildRunnerResult {
  artifacts: unknown[];
  complete?: boolean;
  continuation?: Record<string, unknown>;
  progress?: BackgroundJobProgress;
  artifactCount?: number;
  result?: Record<string, unknown>;
}

const CONTINUATION_SLICE_MAX_RETRIES = 3;
const CONTINUATION_SLICE_RETRY_BASE_DELAY_MS = 30 * 1000;
const CONTINUATION_SLICE_RETRY_MAX_DELAY_MS = 5 * 60 * 1000;

export interface RepositoryIndexBackgroundJobServiceOptions {
  state: StateStore;
  repositoryService: RepositoryService;
  repositoryActivityService: RepositoryActivityService;
  repositoryArtifactIndexService: {
    rebuild(input: {
      repositoryName: string;
      continuation?: Record<string, unknown>;
    }): Promise<RepositoryIndexRebuildRunnerResult>;
  };
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
      maxAttempts: 3,
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
    const continuation = jobContinuation(job);
    const running: BackgroundJobRecord = {
      ...jobWithoutFinish,
      status: "running",
      attempts: continuation === undefined ? job.attempts + 1 : job.attempts,
      startedAt,
    };
    await this.options.state.backgroundJobs.save(running);
    try {
      const result = await this.options.repositoryArtifactIndexService.rebuild(
        continuation === undefined ? { repositoryName } : { repositoryName, continuation },
      );
      const finishedAt = this.options.clock.now().toISOString();
      const artifactCount = result.artifactCount ?? result.artifacts.length;
      if (result.complete === false) {
        await this.options.state.backgroundJobs.save({
          ...running,
          status: "pending",
          scheduledAt: finishedAt,
          lastHeartbeatAt: finishedAt,
          ...(result.progress === undefined ? {} : { progress: result.progress }),
          result: {
            ...(result.result ?? {}),
            continuation: result.continuation ?? {},
            artifactCount,
          },
        });
        return;
      }
      await this.options.repositoryActivityService.recordArtifactIndexRebuild({
        repositoryName,
        artifactCount,
      });
      const { failure: _failure, ...runningWithoutFailure } = running;
      await this.options.state.backgroundJobs.save({
        ...runningWithoutFailure,
        status: "succeeded",
        finishedAt,
        result: {
          ...(result.result ?? {}),
          artifactCount,
        },
      });
    } catch (error) {
      const finishedAt = this.options.clock.now().toISOString();
      if (continuation !== undefined) {
        const retryCount = continuationRetryCount(running) + 1;
        if (retryCount <= CONTINUATION_SLICE_MAX_RETRIES) {
          const message = errorMessage(error);
          const scheduledAt = new Date(
            new Date(finishedAt).getTime() + continuationRetryDelayMs(retryCount),
          ).toISOString();
          await this.options.state.backgroundJobs.save({
            ...running,
            status: "pending",
            scheduledAt,
            lastHeartbeatAt: finishedAt,
            progress: { message: `Retrying after ${message}` },
            result: {
              ...(running.result ?? {}),
              continuation,
              retryCount,
              nextRetryAt: scheduledAt,
              lastFailure: {
                message,
                failedAt: finishedAt,
                retryable: true,
              },
            },
          });
          return;
        }
      }
      await this.options.state.backgroundJobs.save({
        ...running,
        status: "failed",
        finishedAt,
        failure: {
          message: errorMessage(error),
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

function jobContinuation(job: BackgroundJobRecord): Record<string, unknown> | undefined {
  const continuation = job.result?.continuation;
  if (!continuation || typeof continuation !== "object" || Array.isArray(continuation)) {
    return undefined;
  }
  return continuation as Record<string, unknown>;
}

function continuationRetryCount(job: BackgroundJobRecord): number {
  const retryCount = job.result?.retryCount;
  return typeof retryCount === "number" && Number.isFinite(retryCount) && retryCount >= 0
    ? Math.floor(retryCount)
    : 0;
}

function continuationRetryDelayMs(retryCount: number): number {
  return Math.min(
    CONTINUATION_SLICE_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, retryCount - 1),
    CONTINUATION_SLICE_RETRY_MAX_DELAY_MS,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
