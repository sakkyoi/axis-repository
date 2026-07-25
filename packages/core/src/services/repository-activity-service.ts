import type { Clock, RandomId, StateStore } from "../ports/ports";
import type { RepositoryActivityRecord } from "../domain/domain";

export interface RepositoryActivityServiceOptions {
  state: StateStore;
  clock: Clock;
  randomId: RandomId;
}

export interface RecordObjectDeleteInput {
  repositoryName: string;
  path: string;
  objectKey: string;
  contentType?: string;
  size?: number;
}

export class RepositoryActivityService {
  constructor(private readonly options: RepositoryActivityServiceOptions) {}

  async listByRepository(repositoryName: string): Promise<RepositoryActivityRecord[]> {
    return this.options.state.repositoryActivities.listByRepository(repositoryName);
  }

  async recordObjectDelete(input: RecordObjectDeleteInput): Promise<RepositoryActivityRecord> {
    const activity: RepositoryActivityRecord = {
      id: this.options.randomId.create("activity"),
      repositoryName: input.repositoryName,
      type: "object.delete",
      actor: "admin",
      summary: `Deleted ${input.path}`,
      metadata: {
        path: input.path,
        objectKey: input.objectKey,
        ...(input.contentType !== undefined ? { contentType: input.contentType } : {}),
        ...(input.size !== undefined ? { size: input.size } : {}),
      },
      createdAt: this.options.clock.now().toISOString(),
    };
    await this.options.state.repositoryActivities.save(activity);
    return activity;
  }
}
