import type {
  BackgroundJobRecord,
  Clock,
  RepositoryObjectStore,
  RepositoryService,
  StateStore,
} from "@axis-repository/core";
import type { RepositoryRuntimePluginRegistry } from "../plugins/repository-runtime-plugin-registry";
import type { RepositoryWriteLock } from "./repository-write-lock";
import { runRepositoryMaintenance } from "./repository-maintenance";

export const REPOSITORY_MAINTENANCE_JOB_ID = "repository.maintenance";

export interface RepositoryMaintenanceJobServiceOptions {
  state: StateStore;
  repositoryService: RepositoryService;
  plugins: RepositoryRuntimePluginRegistry;
  repositoryObjectStore: RepositoryObjectStore;
  writeLock: RepositoryWriteLock;
  clock: Clock;
}

export interface RepositoryMaintenanceRequestInput {
  force?: boolean;
}

export class RepositoryMaintenanceJobService {
  constructor(private readonly options: RepositoryMaintenanceJobServiceOptions) {}

  async request(input: RepositoryMaintenanceRequestInput = {}): Promise<BackgroundJobRecord> {
    const existing = await this.options.state.backgroundJobs.get(REPOSITORY_MAINTENANCE_JOB_ID);
    if (existing?.status === "pending" || existing?.status === "running") {
      return existing;
    }
    if (input.force !== true && existing?.status === "succeeded" && nextRunAt(existing) > this.options.clock.now()) {
      return existing;
    }
    const requestedAt = this.options.clock.now().toISOString();
    const job: BackgroundJobRecord = {
      id: REPOSITORY_MAINTENANCE_JOB_ID,
      type: "repository.maintenance",
      status: "pending",
      subject: { type: "system", id: "repositories" },
      priority: -20,
      attempts: existing?.attempts ?? 0,
      maxAttempts: 3,
      requestedAt,
      scheduledAt: requestedAt,
    };
    await this.options.state.backgroundJobs.save(job);
    return job;
  }

  async runBackgroundJob(job: BackgroundJobRecord): Promise<void> {
    const startedAt = this.options.clock.now().toISOString();
    const running: BackgroundJobRecord = {
      ...job,
      status: "running",
      attempts: job.attempts + 1,
      startedAt,
    };
    await this.options.state.backgroundJobs.save(running);
    try {
      const run = await runRepositoryMaintenance({
        repositories: await this.options.repositoryService.list(),
        plugins: this.options.plugins,
        repositoryObjectStore: this.options.repositoryObjectStore,
        writeLock: this.options.writeLock,
        clock: this.options.clock,
      });
      const finishedAt = this.options.clock.now().toISOString();
      const { failure: _failure, ...runningWithoutFailure } = running;
      await this.options.state.backgroundJobs.save({
        ...runningWithoutFailure,
        status: "succeeded",
        finishedAt,
        result: {
          refreshedRepositoryCount: run.refreshed.length,
          failureCount: run.failures.length,
          nextRunAt: run.nextRunAt.toISOString(),
        },
      });
      for (const failure of run.failures) {
        console.error(`Repository maintenance failed for ${failure.repositoryName}: ${failure.message}`);
      }
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

export function repositoryMaintenanceNextRunAt(job: BackgroundJobRecord | null, fallback: Date): Date {
  if (!job) return fallback;
  const next = nextRunAt(job);
  return Number.isNaN(next.getTime()) || next.getTime() <= 0 ? fallback : next;
}

function nextRunAt(job: BackgroundJobRecord): Date {
  return typeof job.result?.nextRunAt === "string" ? new Date(job.result.nextRunAt) : new Date(0);
}
