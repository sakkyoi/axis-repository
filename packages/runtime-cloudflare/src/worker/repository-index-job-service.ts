import type {
  Clock,
  BackgroundJobRecord,
  BackgroundJobType,
  Repository,
  RepositoryActivityService,
  RepositoryIndexJobKind,
  RepositoryIndexJobRecord,
  RepositoryService,
  StateStore,
} from "@axis-repository/core";
import type { PluginRepositoryArtifactIndexService } from "./runtime-services";

export interface RepositoryIndexJobServiceOptions {
  state: StateStore;
  repositoryService: RepositoryService;
  repositoryActivityService: RepositoryActivityService;
  repositoryArtifactIndexService: Pick<PluginRepositoryArtifactIndexService, "rebuild">;
  clock: Clock;
}

export interface RequestRepositoryIndexJobInput {
  repositoryName: string;
}

export class RepositoryIndexJobService {
  constructor(private readonly options: RepositoryIndexJobServiceOptions) {}

  async getByRepository(repositoryName: string): Promise<RepositoryIndexJobRecord | null> {
    return this.options.state.repositoryIndexJobs.getByRepository(repositoryName);
  }

  async request(input: RequestRepositoryIndexJobInput): Promise<RepositoryIndexJobRecord> {
    const repository = await this.options.repositoryService.getByName(input.repositoryName);
    const existing = await this.options.state.repositoryIndexJobs.getByRepository(repository.name);
    const requestedAt = this.options.clock.now().toISOString();
    const kind = repositoryIndexJobKind(repository);
    if (existing?.status === "running") {
      const running: RepositoryIndexJobRecord = {
        ...existing,
        kind,
        requestedAt,
        rerunRequestedAt: requestedAt,
      };
      await this.options.state.repositoryIndexJobs.save(running);
      await this.options.state.backgroundJobs.save(backgroundJobFromRepositoryIndexJob(running));
      return running;
    }
    const pending: RepositoryIndexJobRecord = {
      repositoryName: repository.name,
      kind,
      status: "pending",
      requestedAt,
      attempts: existing?.attempts ?? 0,
      ...(existing?.lastSuccessAt === undefined ? {} : { lastSuccessAt: existing.lastSuccessAt }),
      ...(existing?.lastFailure === undefined ? {} : { lastFailure: existing.lastFailure }),
    };
    await this.options.state.repositoryIndexJobs.save(pending);
    await this.options.state.backgroundJobs.save(backgroundJobFromRepositoryIndexJob(pending));
    return pending;
  }

  async migrateLegacyPendingJobs(): Promise<number> {
    let migrated = 0;
    for (const job of await this.options.state.repositoryIndexJobs.listRunnable()) {
      const id = repositoryIndexBackgroundJobId(job.repositoryName);
      if (await this.options.state.backgroundJobs.get(id)) continue;
      await this.options.state.backgroundJobs.save(backgroundJobFromRepositoryIndexJob(job));
      migrated += 1;
    }
    return migrated;
  }

  async runBackgroundJob(job: BackgroundJobRecord): Promise<void> {
    const projection = await this.options.state.repositoryIndexJobs.getByRepository(job.subject.id)
      ?? repositoryIndexJobFromBackgroundJob(job);
    await this.run(projection);
  }

  private async run(job: RepositoryIndexJobRecord): Promise<RepositoryIndexJobRecord> {
    const startedAt = this.options.clock.now().toISOString();
    const running: RepositoryIndexJobRecord = {
      repositoryName: job.repositoryName,
      kind: job.kind,
      status: "running",
      requestedAt: job.requestedAt,
      attempts: job.attempts + 1,
      startedAt,
      ...(job.lastSuccessAt === undefined ? {} : { lastSuccessAt: job.lastSuccessAt }),
      ...(job.lastFailure === undefined ? {} : { lastFailure: job.lastFailure }),
    };
    await this.options.state.repositoryIndexJobs.save(running);
    await this.options.state.backgroundJobs.save(backgroundJobFromRepositoryIndexJob(running));
    try {
      const result = await this.options.repositoryArtifactIndexService.rebuild({
        repositoryName: running.repositoryName,
      });
      const finishedAt = this.options.clock.now().toISOString();
      await this.options.repositoryActivityService.recordArtifactIndexRebuild({
        repositoryName: running.repositoryName,
        artifactCount: result.artifacts.length,
      });
      const current = await this.options.state.repositoryIndexJobs.getByRepository(running.repositoryName);
      const completed: RepositoryIndexJobRecord = {
        repositoryName: running.repositoryName,
        kind: running.kind,
        status: current?.rerunRequestedAt ? "pending" : "ready",
        requestedAt: current?.rerunRequestedAt ?? running.requestedAt,
        attempts: running.attempts,
        startedAt,
        finishedAt,
        lastSuccessAt: finishedAt,
      };
      await this.options.state.repositoryIndexJobs.save(completed);
      await this.options.state.backgroundJobs.save(backgroundJobFromRepositoryIndexJob(completed, {
        result: { artifactCount: result.artifacts.length },
      }));
      return completed;
    } catch (error) {
      const finishedAt = this.options.clock.now().toISOString();
      const current = await this.options.state.repositoryIndexJobs.getByRepository(running.repositoryName);
      const failed: RepositoryIndexJobRecord = {
        repositoryName: running.repositoryName,
        kind: running.kind,
        status: current?.rerunRequestedAt ? "pending" : "failed",
        requestedAt: current?.rerunRequestedAt ?? running.requestedAt,
        attempts: running.attempts,
        startedAt,
        finishedAt,
        ...(running.lastSuccessAt === undefined ? {} : { lastSuccessAt: running.lastSuccessAt }),
        lastFailure: {
          message: error instanceof Error ? error.message : String(error),
          failedAt: finishedAt,
        },
      };
      await this.options.state.repositoryIndexJobs.save(failed);
      await this.options.state.backgroundJobs.save(backgroundJobFromRepositoryIndexJob(failed));
      return failed;
    }
  }
}

export function repositoryIndexBackgroundJobId(repositoryName: string): string {
  return `repository.index:${repositoryName}`;
}

function backgroundJobFromRepositoryIndexJob(
  job: RepositoryIndexJobRecord,
  options: { result?: Record<string, unknown> } = {},
): BackgroundJobRecord {
  const status = backgroundStatusFromRepositoryIndexStatus(job.status);
  return {
    id: repositoryIndexBackgroundJobId(job.repositoryName),
    type: backgroundTypeFromRepositoryIndexKind(job.kind),
    status,
    subject: { type: "repository", id: job.repositoryName, repositoryName: job.repositoryName },
    repositoryName: job.repositoryName,
    priority: 0,
    attempts: job.attempts,
    requestedAt: job.requestedAt,
    scheduledAt: job.requestedAt,
    ...(job.startedAt === undefined ? {} : { startedAt: job.startedAt }),
    ...(job.finishedAt === undefined ? {} : { finishedAt: job.finishedAt }),
    ...(options.result === undefined ? {} : { result: options.result }),
    ...(job.lastFailure === undefined ? {} : {
      failure: {
        message: job.lastFailure.message,
        failedAt: job.lastFailure.failedAt,
        retryable: true,
      },
    }),
  };
}

function backgroundStatusFromRepositoryIndexStatus(status: RepositoryIndexJobRecord["status"]): BackgroundJobRecord["status"] {
  if (status === "ready") return "succeeded";
  return status;
}

function backgroundTypeFromRepositoryIndexKind(kind: RepositoryIndexJobKind): BackgroundJobType {
  if (kind === "hosted-rebuild") return "repository.index.hosted-rebuild";
  if (kind === "proxy-refresh") return "repository.index.proxy-refresh";
  return "repository.index.group-refresh";
}

function repositoryIndexJobFromBackgroundJob(job: BackgroundJobRecord): RepositoryIndexJobRecord {
  return {
    repositoryName: job.subject.id,
    kind: repositoryIndexKindFromBackgroundType(job.type),
    status: "pending",
    requestedAt: job.requestedAt,
    attempts: job.attempts,
    ...(job.startedAt === undefined ? {} : { startedAt: job.startedAt }),
    ...(job.finishedAt === undefined ? {} : { finishedAt: job.finishedAt }),
    ...(job.failure === undefined ? {} : {
      lastFailure: {
        message: job.failure.message,
        failedAt: job.failure.failedAt,
      },
    }),
  };
}

function repositoryIndexKindFromBackgroundType(type: BackgroundJobType): RepositoryIndexJobKind {
  if (type === "repository.index.proxy-refresh") return "proxy-refresh";
  if (type === "repository.index.group-refresh") return "group-refresh";
  return "hosted-rebuild";
}

function repositoryIndexJobKind(repository: Repository): RepositoryIndexJobKind {
  if (repository.kind === "proxy") return "proxy-refresh";
  if (repository.kind === "group") return "group-refresh";
  return "hosted-rebuild";
}
