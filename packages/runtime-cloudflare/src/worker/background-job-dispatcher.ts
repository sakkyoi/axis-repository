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
  leaseTtlMs?: number;
  createLeaseId?: () => string;
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
    for (let index = 0; index < limit; index++) {
      const job = await this.acquire();
      if (!job) break;
      processed += 1;
      try {
        const runner = this.options.runners.find((candidate) => candidate.supports(job));
        if (!runner) {
          throw new Error(`Background job runner is not configured for type: ${job.type}`);
        }
        await runner.run(job);
        await this.releaseLeaseIfSettled(job);
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

  private async acquire(): Promise<BackgroundJobRecord | null> {
    const now = this.options.clock.now();
    const leaseTtlMs = this.options.leaseTtlMs ?? 5 * 60 * 1000;
    const leaseExpiresAt = new Date(now.getTime() + leaseTtlMs);
    return this.options.state.backgroundJobs.acquireRunnable({
      leaseId: this.options.createLeaseId?.() ?? createLeaseId(),
      leaseExpiresAt: leaseExpiresAt.toISOString(),
      now: now.toISOString(),
    });
  }

  private async fail(job: BackgroundJobRecord, error: unknown): Promise<void> {
    const failedAt = this.options.clock.now().toISOString();
    const { leaseId: _leaseId, leaseExpiresAt: _leaseExpiresAt, ...jobWithoutLease } = job;
    await this.options.state.backgroundJobs.save({
      ...jobWithoutLease,
      status: "failed",
      finishedAt: failedAt,
      failure: {
        message: error instanceof Error ? error.message : String(error),
        failedAt,
        retryable: true,
      },
    });
  }

  private async releaseLeaseIfSettled(job: BackgroundJobRecord): Promise<void> {
    const current = await this.options.state.backgroundJobs.get(job.id);
    if (!current || current.leaseId !== job.leaseId || current.status === "running" || current.status === "canceling") {
      return;
    }
    const { leaseId: _leaseId, leaseExpiresAt: _leaseExpiresAt, ...released } = current;
    await this.options.state.backgroundJobs.save(released);
  }
}

function createLeaseId(): string {
  return `lease_${crypto.randomUUID()}`;
}
