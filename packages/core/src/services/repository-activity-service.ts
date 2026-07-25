import type { Clock, RandomId, StateStore } from "../ports/ports";
import { REPOSITORY_ACTIVITY_TYPES, type RepositoryActivityRecord } from "../domain/domain";

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

export interface RecordObjectUpdateInput {
  repositoryName: string;
  path: string;
  objectKey: string;
  contentType?: string;
  previousContentType?: string;
  previousSize?: number;
  previousEtag?: string;
}

export interface RecordArtifactIndexRebuildInput {
  repositoryName: string;
  artifactCount: number;
}

export interface RecordArtifactDeleteInput {
  repositoryName: string;
  artifactId: string;
  identity: string;
  summary: string;
  name: string;
  version?: string;
  objectKeys: string[];
  deletedObjectKeys: string[];
  missingObjectKeys?: string[];
  skippedObjectKeys?: string[];
  failedObjectKeys?: Array<{
    objectKey: string;
    message: string;
  }>;
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
      type: REPOSITORY_ACTIVITY_TYPES.objectDelete,
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

  async recordObjectUpdate(input: RecordObjectUpdateInput): Promise<RepositoryActivityRecord> {
    const activity: RepositoryActivityRecord = {
      id: this.options.randomId.create("activity"),
      repositoryName: input.repositoryName,
      type: REPOSITORY_ACTIVITY_TYPES.objectUpdate,
      actor: "admin",
      summary: `Updated ${input.path}`,
      metadata: {
        path: input.path,
        objectKey: input.objectKey,
        ...(input.contentType !== undefined ? { contentType: input.contentType } : {}),
        ...(input.previousContentType !== undefined ? { previousContentType: input.previousContentType } : {}),
        ...(input.previousSize !== undefined ? { previousSize: input.previousSize } : {}),
        ...(input.previousEtag !== undefined ? { previousEtag: input.previousEtag } : {}),
      },
      createdAt: this.options.clock.now().toISOString(),
    };
    await this.options.state.repositoryActivities.save(activity);
    return activity;
  }

  async recordArtifactIndexRebuild(input: RecordArtifactIndexRebuildInput): Promise<RepositoryActivityRecord> {
    const activity: RepositoryActivityRecord = {
      id: this.options.randomId.create("activity"),
      repositoryName: input.repositoryName,
      type: REPOSITORY_ACTIVITY_TYPES.artifactIndexRebuild,
      actor: "admin",
      summary: "Rebuilt artifact index",
      metadata: {
        artifactCount: input.artifactCount,
      },
      createdAt: this.options.clock.now().toISOString(),
    };
    await this.options.state.repositoryActivities.save(activity);
    return activity;
  }

  async recordArtifactDelete(input: RecordArtifactDeleteInput): Promise<RepositoryActivityRecord> {
    const activity: RepositoryActivityRecord = {
      id: this.options.randomId.create("activity"),
      repositoryName: input.repositoryName,
      type: REPOSITORY_ACTIVITY_TYPES.artifactDelete,
      actor: "admin",
      summary: `Deleted artifact ${input.summary}`,
      metadata: {
        artifactId: input.artifactId,
        identity: input.identity,
        name: input.name,
        ...(input.version !== undefined ? { version: input.version } : {}),
        objectKeys: [...input.objectKeys],
        deletedObjectKeys: [...input.deletedObjectKeys],
        missingObjectKeys: [...(input.missingObjectKeys ?? [])],
        skippedObjectKeys: [...(input.skippedObjectKeys ?? [])],
        failedObjectKeys: [...(input.failedObjectKeys ?? [])],
      },
      createdAt: this.options.clock.now().toISOString(),
    };
    await this.options.state.repositoryActivities.save(activity);
    return activity;
  }
}
