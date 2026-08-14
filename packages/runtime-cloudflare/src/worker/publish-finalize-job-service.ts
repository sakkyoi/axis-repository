import type {
  BackgroundJobRecord,
  Clock,
  FinalizePublishSessionInput,
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

export type RequestPublishFinalizeJobInput = FinalizePublishSessionInput;

export interface RequestPublishFinalizeJobResult {
  session: PublishSession;
  job: BackgroundJobRecord;
}

export class PublishFinalizeJobService {
  constructor(private readonly options: PublishFinalizeJobServiceOptions) {}

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
    const id = publishFinalizeBackgroundJobId(session.id);
    const existing = await this.options.state.backgroundJobs.get(id);
    const requestedAt = this.options.clock.now().toISOString();
    if (existing?.status === "running") {
      return { session, job: existing };
    }
    if (existing?.status === "pending") {
      return { session, job: existing };
    }
    const job: BackgroundJobRecord = {
      id,
      type: "publish.finalize",
      status: session.status === "finalized" ? "succeeded" : "pending",
      subject: { type: "publish-session", id: session.id, repositoryName: session.repositoryName },
      repositoryName: session.repositoryName,
      priority: 0,
      requestedAt,
      scheduledAt: requestedAt,
      attempts: existing?.attempts ?? 0,
      maxAttempts: 3,
      ...(existing?.failure === undefined ? {} : { failure: existing.failure }),
      ...(session.status === "finalized" ? { finishedAt: requestedAt } : {}),
    };
    await this.options.state.backgroundJobs.save(job);
    return { session, job };
  }

  async runBackgroundJob(job: BackgroundJobRecord): Promise<void> {
    const startedAt = this.options.clock.now().toISOString();
    const repositoryName = job.repositoryName ?? job.subject.repositoryName;
    const { finishedAt: _finishedAt, ...jobWithoutFinish } = job;
    const running: BackgroundJobRecord = {
      ...jobWithoutFinish,
      status: "running",
      attempts: job.attempts + 1,
      startedAt,
    };
    await this.options.state.backgroundJobs.save(running);
    try {
      const session = await this.options.state.publishSessions.get(job.subject.id);
      if (!session) {
        throw new Error(`Publish session not found: ${job.subject.id}`);
      }
      await this.options.publishSessionService.finalize({
        sessionId: session.id,
        principal: session.requestedBy,
      });
      const finishedAt = this.options.clock.now().toISOString();
      const { failure: _failure, ...runningWithoutFailure } = running;
      const completed: BackgroundJobRecord = {
        ...runningWithoutFailure,
        status: "succeeded",
        finishedAt,
      };
      await this.options.state.backgroundJobs.save(completed);
      return;
    } catch (error) {
      const finishedAt = this.options.clock.now().toISOString();
      const failed: BackgroundJobRecord = {
        ...running,
        ...(repositoryName === undefined ? {} : { repositoryName }),
        status: "failed",
        finishedAt,
        failure: {
          message: error instanceof Error ? error.message : String(error),
          failedAt: finishedAt,
          retryable: true,
        },
        result: {
          disableAutoRetry: true,
        },
      };
      await this.options.state.backgroundJobs.save(failed);
    }
  }
}

export function publishFinalizeBackgroundJobId(sessionId: string): string {
  return `publish.finalize:${sessionId}`;
}
