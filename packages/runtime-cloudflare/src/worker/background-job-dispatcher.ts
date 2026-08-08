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

const BACKGROUND_JOB_RETRY_BASE_DELAY_MS = 30 * 1000;
const BACKGROUND_JOB_RETRY_MAX_DELAY_MS = 5 * 60 * 1000;

export class BackgroundJobDispatcher {
  constructor(private readonly options: BackgroundJobDispatcherOptions) {}

  async drain(input: DrainBackgroundJobsInput = {}): Promise<DrainBackgroundJobsResult> {
    const limit = input.limit ?? 10;
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error("Background job drain limit must be a positive integer");
    }
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
        if (current?.status === "failed" && await this.rescheduleRetryableFailure(current)) {
          continue;
        }
        if (current?.status === "failed") {
          failed += 1;
        }
      } catch (error) {
        const failedJob = await this.fail(job, error);
        if (await this.rescheduleRetryableFailure(failedJob)) {
          continue;
        }
        failed += 1;
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

  private async fail(job: BackgroundJobRecord, error: unknown): Promise<BackgroundJobRecord> {
    const failedAt = this.options.clock.now().toISOString();
    const { leaseId: _leaseId, leaseExpiresAt: _leaseExpiresAt, ...jobWithoutLease } = job;
    const failed: BackgroundJobRecord = {
      ...jobWithoutLease,
      status: "failed",
      attempts: job.attempts + 1,
      finishedAt: failedAt,
      failure: {
        message: errorMessage(error),
        failedAt,
        retryable: true,
      },
    };
    await this.options.state.backgroundJobs.save(failed);
    return failed;
  }

  private async releaseLeaseIfSettled(job: BackgroundJobRecord): Promise<void> {
    const current = await this.options.state.backgroundJobs.get(job.id);
    if (!current || current.leaseId !== job.leaseId || current.status === "running" || current.status === "canceling") {
      return;
    }
    const { leaseId: _leaseId, leaseExpiresAt: _leaseExpiresAt, ...released } = current;
    await this.options.state.backgroundJobs.save(released);
  }

  private async rescheduleRetryableFailure(job: BackgroundJobRecord): Promise<boolean> {
    if (job.status !== "failed" || job.failure?.retryable !== true || !retryBudgetRemaining(job)) {
      return false;
    }
    const now = this.options.clock.now();
    const retryCount = Math.max(1, job.attempts);
    const scheduledAt = new Date(now.getTime() + retryDelayMs(retryCount)).toISOString();
    const { leaseId: _leaseId, leaseExpiresAt: _leaseExpiresAt, failure, finishedAt: _finishedAt, ...jobWithoutTerminalFailure } = job;
    await this.options.state.backgroundJobs.save({
      ...jobWithoutTerminalFailure,
      status: "pending",
      scheduledAt,
      lastHeartbeatAt: failure.failedAt,
      progress: { message: `Retrying after ${failure.message}` },
      result: {
        ...(job.result ?? {}),
        lastFailure: failure,
      },
    });
    return true;
  }
}

function createLeaseId(): string {
  return `lease_${crypto.randomUUID()}`;
}

function retryBudgetRemaining(job: BackgroundJobRecord): boolean {
  return job.result?.disableAutoRetry !== true
    && job.maxAttempts !== undefined
    && job.attempts < job.maxAttempts;
}

function retryDelayMs(retryCount: number): number {
  return Math.min(
    BACKGROUND_JOB_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, retryCount - 1),
    BACKGROUND_JOB_RETRY_MAX_DELAY_MS,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
