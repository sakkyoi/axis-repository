import type {
  BackgroundJobListQuery,
  BackgroundJobRecord,
  Clock,
  StateStore,
} from "@axis-repository/core";

export interface BackgroundJobServiceOptions {
  state: StateStore;
  clock: Clock;
}

export class BackgroundJobService {
  constructor(private readonly options: BackgroundJobServiceOptions) {}

  async get(id: string): Promise<BackgroundJobRecord | null> {
    return this.options.state.backgroundJobs.get(id);
  }

  async list(query: BackgroundJobListQuery = {}): Promise<{ jobs: BackgroundJobRecord[]; total: number }> {
    return this.options.state.backgroundJobs.list(query);
  }

  async cancel(id: string): Promise<BackgroundJobRecord | null> {
    const canceled = await this.options.state.backgroundJobs.cancel(id, this.options.clock.now().toISOString());
    if (!canceled) return null;
    if (canceled.status === "canceled") {
      await this.cancelLegacyPendingJob(canceled);
    }
    return canceled;
  }

  private async cancelLegacyPendingJob(job: BackgroundJobRecord): Promise<void> {
    if (job.type === "publish.finalize" && job.subject.type === "publish-session") {
      await this.options.state.publishFinalizeJobs.deleteBySession(job.subject.id);
      return;
    }
    if (job.type.startsWith("repository.index.") && job.subject.type === "repository") {
      await this.options.state.repositoryIndexJobs.deleteByRepository(job.subject.id);
    }
  }
}
