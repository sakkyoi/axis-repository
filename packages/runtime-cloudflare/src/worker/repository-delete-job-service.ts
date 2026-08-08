import type {
  BackgroundJobRecord,
  Clock,
  RepositoryObjectStore,
  StateStore,
} from "@axis-repository/core";
import type { PluginRepositoryService } from "./runtime-services";

export interface RepositoryDeleteJobServiceOptions {
  state: StateStore;
  repositoryService: Pick<PluginRepositoryService, "getByName" | "delete">;
  repositoryObjectStore: RepositoryObjectStore;
  clock: Clock;
}

export interface RequestRepositoryDeleteJobInput {
  repositoryName: string;
}

export class RepositoryDeleteJobService {
  constructor(private readonly options: RepositoryDeleteJobServiceOptions) {}

  async request(input: RequestRepositoryDeleteJobInput): Promise<BackgroundJobRecord> {
    const repository = await this.options.repositoryService.getByName(input.repositoryName);
    const id = repositoryDeleteBackgroundJobId(repository.name);
    const existing = await this.options.state.backgroundJobs.get(id);
    if (existing?.status === "pending" || existing?.status === "running") {
      return existing;
    }
    const requestedAt = this.options.clock.now().toISOString();
    const job: BackgroundJobRecord = {
      id,
      type: "repository.delete",
      status: "pending",
      subject: { type: "repository", id: repository.name, repositoryName: repository.name },
      repositoryName: repository.name,
      priority: 10,
      attempts: existing?.attempts ?? 0,
      maxAttempts: 3,
      requestedAt,
      scheduledAt: requestedAt,
    };
    await this.options.state.backgroundJobs.save(job);
    return job;
  }

  async runBackgroundJob(job: BackgroundJobRecord): Promise<void> {
    const repositoryName = job.repositoryName ?? job.subject.repositoryName ?? job.subject.id;
    const startedAt = this.options.clock.now().toISOString();
    const running: BackgroundJobRecord = {
      ...job,
      status: "running",
      attempts: job.attempts + 1,
      startedAt,
      progress: { message: "Deleting repository objects" },
    };
    await this.options.state.backgroundJobs.save(running);
    try {
      await this.options.repositoryService.getByName(repositoryName);
      const deletedObjectCount = await deleteObjectPrefix({
        objectStore: this.options.repositoryObjectStore,
        prefix: `repositories/${repositoryName}/`,
        onProgress: async (count) => {
          await this.options.state.backgroundJobs.save({
            ...running,
            lastHeartbeatAt: this.options.clock.now().toISOString(),
            progress: { current: count, message: "Deleting repository objects" },
          });
        },
      });
      await this.options.repositoryService.delete(repositoryName);
      const finishedAt = this.options.clock.now().toISOString();
      const { failure: _failure, ...runningWithoutFailure } = running;
      await this.options.state.backgroundJobs.save({
        ...runningWithoutFailure,
        status: "succeeded",
        finishedAt,
        progress: { current: deletedObjectCount, message: "Deleted repository" },
        result: { deletedObjectCount },
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

export function repositoryDeleteBackgroundJobId(repositoryName: string): string {
  return `repository.delete:${repositoryName}`;
}

export async function deleteObjectPrefix(input: {
  objectStore: RepositoryObjectStore;
  prefix: string;
  onProgress?: (deletedObjectCount: number) => Promise<void>;
}): Promise<number> {
  let deleted = 0;
  let previousFirstKey: string | undefined;
  for (;;) {
    const listing = await input.objectStore.listObjects({ prefix: input.prefix });
    const keys = listing.objects.map((object) => object.key);
    if (keys.length === 0 || keys[0] === previousFirstKey) {
      return deleted;
    }
    await input.objectStore.deleteObjects(keys);
    deleted += keys.length;
    await input.onProgress?.(deleted);
    if (!listing.truncated) {
      return deleted;
    }
    previousFirstKey = keys[0];
  }
}
