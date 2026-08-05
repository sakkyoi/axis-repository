import type {
  BackgroundJobRecord,
  Clock,
  StateStore,
} from "@axis-repository/core";

export interface BackgroundJobRunner {
  supports(job: BackgroundJobRecord): boolean;
  run(job: BackgroundJobRecord): Promise<void>;
}

export interface BackgroundJobDispatcherOptions {
  state: StateStore;
  clock: Clock;
  runners: BackgroundJobRunner[];
}

export interface DrainBackgroundJobsInput {
  limit?: number;
}

export interface DrainBackgroundJobsResult {
  processed: number;
  failed: number;
  remaining: number;
}

export class BackgroundJobDispatcher {
  constructor(private readonly options: BackgroundJobDispatcherOptions) {}

  async drain(input: DrainBackgroundJobsInput = {}): Promise<DrainBackgroundJobsResult> {
    const limit = input.limit ?? 10;
    let processed = 0;
    let failed = 0;
    for (const job of await this.options.state.backgroundJobs.listRunnable({ limit })) {
      processed += 1;
      try {
        const runner = this.options.runners.find((candidate) => candidate.supports(job));
        if (!runner) {
          throw new Error(`Background job runner is not configured for type: ${job.type}`);
        }
        await runner.run(job);
        const current = await this.options.state.backgroundJobs.get(job.id);
        if (current?.status === "failed") {
          failed += 1;
        }
      } catch (error) {
        failed += 1;
        await this.fail(job, error);
      }
    }

    return {
      processed,
      failed,
      remaining: (await this.options.state.backgroundJobs.listRunnable({ limit: 1 })).length,
    };
  }

  private async fail(job: BackgroundJobRecord, error: unknown): Promise<void> {
    const failedAt = this.options.clock.now().toISOString();
    await this.options.state.backgroundJobs.save({
      ...job,
      status: "failed",
      finishedAt: failedAt,
      failure: {
        message: error instanceof Error ? error.message : String(error),
        failedAt,
        retryable: true,
      },
    });
  }
}
