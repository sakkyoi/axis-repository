import type {
  BackgroundJobRecord,
  Clock,
  FinalizePublishSessionInput,
  PublishFinalizeJobRecord,
  PublishSession,
  PublishSessionService,
  StateStore,
} from "@axis-repository/core";

export interface PublishFinalizeJobServiceOptions {
  state: StateStore;
  publishSessionService: Pick<PublishSessionService, "requestFinalize" | "finalize"> & {
    requestFinalizeAsAdmin?(input: { sessionId: string }): Promise<{ session: PublishSession }>;
  };
  clock: Clock;
}

export interface RequestPublishFinalizeJobInput extends FinalizePublishSessionInput {}

export interface RequestPublishFinalizeJobResult {
  session: PublishSession;
  job: PublishFinalizeJobRecord;
}

export interface DrainPublishFinalizeJobsInput {
  limit?: number;
}

export interface DrainPublishFinalizeJobsResult {
  processed: number;
  failed: number;
  remaining: number;
}

export class PublishFinalizeJobService {
  constructor(private readonly options: PublishFinalizeJobServiceOptions) {}

  async getBySession(sessionId: string): Promise<PublishFinalizeJobRecord | null> {
    return this.options.state.publishFinalizeJobs.getBySession(sessionId);
  }

  async request(input: RequestPublishFinalizeJobInput): Promise<RequestPublishFinalizeJobResult> {
    const result = await this.options.publishSessionService.requestFinalize(input);
    return this.saveRequestedJob(result.session);
  }

  async requestAsAdmin(input: { sessionId: string }): Promise<RequestPublishFinalizeJobResult> {
    const result = this.options.publishSessionService.requestFinalizeAsAdmin
      ? await this.options.publishSessionService.requestFinalizeAsAdmin(input)
      : await this.options.publishSessionService.requestFinalize({
        sessionId: input.sessionId,
        principal: {
          tokenId: "admin",
          name: "admin",
          permissions: ["publish"],
          repositories: [],
          ecosystemScopes: {},
          signingKeyIds: [],
        },
      });
    return this.saveRequestedJob(result.session);
  }

  private async saveRequestedJob(session: PublishSession): Promise<RequestPublishFinalizeJobResult> {
    const existing = await this.options.state.publishFinalizeJobs.getBySession(session.id);
    const requestedAt = this.options.clock.now().toISOString();
    if (existing?.status === "running") {
      return { session, job: existing };
    }
    if (existing?.status === "pending") {
      return { session, job: existing };
    }
    const job: PublishFinalizeJobRecord = {
      sessionId: session.id,
      repositoryName: session.repositoryName,
      status: session.status === "finalized" ? "ready" : "pending",
      requestedAt,
      attempts: existing?.attempts ?? 0,
      ...(existing?.lastFailure === undefined ? {} : { lastFailure: existing.lastFailure }),
      ...(session.status === "finalized" ? { finishedAt: requestedAt } : {}),
    };
    await this.options.state.publishFinalizeJobs.save(job);
    await this.options.state.backgroundJobs.save(backgroundJobFromPublishFinalizeJob(job));
    return { session, job };
  }

  async drain(input: DrainPublishFinalizeJobsInput = {}): Promise<DrainPublishFinalizeJobsResult> {
    const limit = input.limit ?? 10;
    let processed = 0;
    let failed = 0;
    for (let index = 0; index < limit; index += 1) {
      const job = (await this.options.state.publishFinalizeJobs.listRunnable())[0];
      if (!job) break;
      processed += 1;
      const result = await this.run(job);
      if (result.status === "failed") {
        failed += 1;
      }
    }
    return {
      processed,
      failed,
      remaining: (await this.options.state.publishFinalizeJobs.listRunnable()).length,
    };
  }

  private async run(job: PublishFinalizeJobRecord): Promise<PublishFinalizeJobRecord> {
    const startedAt = this.options.clock.now().toISOString();
    const running: PublishFinalizeJobRecord = {
      sessionId: job.sessionId,
      repositoryName: job.repositoryName,
      status: "running",
      requestedAt: job.requestedAt,
      attempts: job.attempts + 1,
      startedAt,
      ...(job.lastFailure === undefined ? {} : { lastFailure: job.lastFailure }),
    };
    await this.options.state.publishFinalizeJobs.save(running);
    await this.options.state.backgroundJobs.save(backgroundJobFromPublishFinalizeJob(running));
    try {
      const session = await this.options.state.publishSessions.get(running.sessionId);
      if (!session) {
        throw new Error(`Publish session not found: ${running.sessionId}`);
      }
      await this.options.publishSessionService.finalize({
        sessionId: session.id,
        principal: session.requestedBy,
      });
      const finishedAt = this.options.clock.now().toISOString();
      const completed: PublishFinalizeJobRecord = {
        sessionId: running.sessionId,
        repositoryName: running.repositoryName,
        status: "ready",
        requestedAt: running.requestedAt,
        attempts: running.attempts,
        startedAt,
        finishedAt,
      };
      await this.options.state.publishFinalizeJobs.save(completed);
      await this.options.state.backgroundJobs.save(backgroundJobFromPublishFinalizeJob(completed));
      return completed;
    } catch (error) {
      const finishedAt = this.options.clock.now().toISOString();
      const failed: PublishFinalizeJobRecord = {
        sessionId: running.sessionId,
        repositoryName: running.repositoryName,
        status: "failed",
        requestedAt: running.requestedAt,
        attempts: running.attempts,
        startedAt,
        finishedAt,
        lastFailure: {
          message: error instanceof Error ? error.message : String(error),
          failedAt: finishedAt,
        },
      };
      await this.options.state.publishFinalizeJobs.save(failed);
      await this.options.state.backgroundJobs.save(backgroundJobFromPublishFinalizeJob(failed));
      return failed;
    }
  }
}

export function publishFinalizeBackgroundJobId(sessionId: string): string {
  return `publish.finalize:${sessionId}`;
}

function backgroundJobFromPublishFinalizeJob(job: PublishFinalizeJobRecord): BackgroundJobRecord {
  const status = backgroundStatusFromPublishFinalizeStatus(job.status);
  return {
    id: publishFinalizeBackgroundJobId(job.sessionId),
    type: "publish.finalize",
    status,
    subject: { type: "publish-session", id: job.sessionId, repositoryName: job.repositoryName },
    repositoryName: job.repositoryName,
    priority: 0,
    attempts: job.attempts,
    requestedAt: job.requestedAt,
    scheduledAt: job.requestedAt,
    ...(job.startedAt === undefined ? {} : { startedAt: job.startedAt }),
    ...(job.finishedAt === undefined ? {} : { finishedAt: job.finishedAt }),
    ...(job.lastFailure === undefined ? {} : {
      failure: {
        message: job.lastFailure.message,
        failedAt: job.lastFailure.failedAt,
        retryable: true,
      },
    }),
  };
}

function backgroundStatusFromPublishFinalizeStatus(status: PublishFinalizeJobRecord["status"]): BackgroundJobRecord["status"] {
  if (status === "ready") return "succeeded";
  return status;
}
