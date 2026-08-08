import type {
  BackgroundJobRecord,
  Clock,
  RepositoryObjectStore,
  StateStore,
} from "@axis-repository/core";
import type { PluginRepositoryService } from "./runtime-services";
import { deleteObjectPrefix } from "./repository-delete-job-service";

export interface RepositoryProxyCachePurgeJobServiceOptions {
  state: StateStore;
  repositoryService: Pick<PluginRepositoryService, "getByName">;
  repositoryObjectStore: RepositoryObjectStore;
  clock: Clock;
}

export interface RequestRepositoryProxyCachePurgeJobInput {
  repositoryName: string;
  namespace: string;
}

export class RepositoryProxyCachePurgeJobService {
  constructor(private readonly options: RepositoryProxyCachePurgeJobServiceOptions) {}

  async request(input: RequestRepositoryProxyCachePurgeJobInput): Promise<BackgroundJobRecord> {
    const repository = await this.options.repositoryService.getByName(input.repositoryName);
    const id = repositoryProxyCachePurgeBackgroundJobId(repository.name, input.namespace);
    const existing = await this.options.state.backgroundJobs.get(id);
    if (existing?.status === "pending" || existing?.status === "running") {
      return existing;
    }
    const requestedAt = this.options.clock.now().toISOString();
    const job: BackgroundJobRecord = {
      id,
      type: "repository.proxy-cache.purge",
      status: "pending",
      subject: { type: "repository", id: repository.name, repositoryName: repository.name },
      repositoryName: repository.name,
      priority: 0,
      attempts: existing?.attempts ?? 0,
      maxAttempts: 3,
      requestedAt,
      scheduledAt: requestedAt,
      result: { namespace: input.namespace },
    };
    await this.options.state.backgroundJobs.save(job);
    return job;
  }

  async runBackgroundJob(job: BackgroundJobRecord): Promise<void> {
    const repositoryName = job.repositoryName ?? job.subject.repositoryName ?? job.subject.id;
    const namespace = jobNamespace(job);
    const startedAt = this.options.clock.now().toISOString();
    const running: BackgroundJobRecord = {
      ...job,
      status: "running",
      attempts: job.attempts + 1,
      startedAt,
      progress: { message: "Purging proxy byte cache" },
    };
    await this.options.state.backgroundJobs.save(running);
    try {
      await this.options.repositoryService.getByName(repositoryName);
      const deletedObjectCount = await deleteObjectPrefix({
        objectStore: this.options.repositoryObjectStore,
        prefix: proxyByteCachePrefix(repositoryName, namespace),
        onProgress: async (count) => {
          await this.options.state.backgroundJobs.save({
            ...running,
            lastHeartbeatAt: this.options.clock.now().toISOString(),
            progress: { current: count, message: "Purging proxy byte cache" },
          });
        },
      });
      const finishedAt = this.options.clock.now().toISOString();
      const { failure: _failure, ...runningWithoutFailure } = running;
      await this.options.state.backgroundJobs.save({
        ...runningWithoutFailure,
        status: "succeeded",
        finishedAt,
        progress: { current: deletedObjectCount, message: "Purged proxy byte cache" },
        result: { namespace, deletedObjectCount },
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

export function repositoryProxyCachePurgeBackgroundJobId(repositoryName: string, namespace: string): string {
  return `repository.proxy-cache.purge:${repositoryName}:${namespace}`;
}

function proxyByteCachePrefix(repositoryName: string, namespace: string): string {
  return `repositories/${repositoryName}/_proxy-cache/${namespace}/files/`;
}

function jobNamespace(job: BackgroundJobRecord): string {
  const namespace = job.result?.namespace;
  if (typeof namespace !== "string" || namespace.length === 0) {
    throw new Error(`Repository proxy cache purge job is missing namespace: ${job.id}`);
  }
  return namespace;
}
