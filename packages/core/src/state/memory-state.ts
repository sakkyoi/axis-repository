import type {
  PublishSession,
  PublishTokenRecord,
  AdminUserRecord,
  AdminRefreshSessionRecord,
  Repository,
  RepositoryArtifactRecord,
  RepositoryArtifactFamilyRecord,
  RepositoryActivityRecord,
  BackgroundJobRecord,
  RepositorySecretRecord,
  RepositoryPluginPolicyRecord,
  RuntimeSettingsRecord,
} from "../domain/domain";
import type { StateStore } from "../ports/ports";

/**
 * Snapshots a record on the way in and out of the store.
 *
 * The durable adapter serializes to storage and deserializes on read, so
 * callers there can never alias stored state. This in-memory adapter backs the
 * dev worker and the tests, and without cloning it would hand out live
 * references, letting a caller mutate stored state by accident and behave
 * differently from production.
 */
function snapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function snapshotAll<T>(values: T[]): T[] {
  return values.map(snapshot);
}

function clonePublishSession(session: PublishSession): PublishSession {
  return snapshot(session);
}

export class MemoryStateStore implements StateStore {
  private readonly repositoryByName = new Map<string, Repository>();
  private readonly publishSessionById = new Map<string, PublishSession>();
  private readonly backgroundJobById = new Map<string, BackgroundJobRecord>();
  private readonly publishTokenById = new Map<string, PublishTokenRecord>();
  private readonly adminUserById = new Map<string, AdminUserRecord>();
  private readonly adminUserIdByUsername = new Map<string, string>();
  private readonly adminRefreshSessionById = new Map<string, AdminRefreshSessionRecord>();
  private readonly publishTokenIdByName = new Map<string, string>();
  private readonly repositorySecretById = new Map<string, RepositorySecretRecord>();
  private readonly repositorySecretIdByName = new Map<string, string>();
  private readonly repositoryPluginPolicyByEcosystem = new Map<string, RepositoryPluginPolicyRecord>();
  private runtimeSettingsRecord: RuntimeSettingsRecord | null = null;
  private readonly repositoryActivityById = new Map<string, RepositoryActivityRecord>();
  private readonly repositoryArtifactById = new Map<string, RepositoryArtifactRecord>();
  private readonly repositoryArtifactIdByIdentity = new Map<string, string>();

  readonly repositories = {
    getByName: async (name: string): Promise<Repository | null> => {
      const repository = this.repositoryByName.get(name);
      return repository ? snapshot(repository) : null;
    },
    list: async (): Promise<Repository[]> => {
      return snapshotAll([...this.repositoryByName.values()].sort((left, right) =>
        left.name.localeCompare(right.name),
      ));
    },
    save: async (repository: Repository): Promise<void> => {
      this.repositoryByName.set(repository.name, snapshot(repository));
    },
    deleteByName: async (name: string): Promise<boolean> => {
      return this.repositoryByName.delete(name);
    },
  };

  readonly publishSessions = {
    get: async (id: string): Promise<PublishSession | null> => {
      const session = this.publishSessionById.get(id);
      return session ? snapshot(session) : null;
    },
    list: async (): Promise<PublishSession[]> => {
      return snapshotAll([...this.publishSessionById.values()].sort(comparePublishSessions));
    },
    save: async (session: PublishSession): Promise<void> => {
      this.publishSessionById.set(session.id, snapshot(session));
    },
    deleteByRepository: async (repositoryName: string): Promise<number> => {
      let deleted = 0;
      for (const session of [...this.publishSessionById.values()]) {
        if (session.repositoryName !== repositoryName) continue;
        if (this.publishSessionById.delete(session.id)) {
          deleted++;
        }
      }
      return deleted;
    },
    update: async (
      id: string,
      updater: (current: PublishSession) => PublishSession,
    ): Promise<PublishSession | null> => {
      const current = this.publishSessionById.get(id);
      if (!current) {
        return null;
      }
      const updated = snapshot(updater(clonePublishSession(current)));
      this.publishSessionById.set(id, updated);
      return snapshot(updated);
    },
  };

  readonly publishTokens = {
    getById: async (id: string): Promise<PublishTokenRecord | null> => {
      const token = this.publishTokenById.get(id);
      return token ? snapshot(token) : null;
    },
    getByName: async (name: string): Promise<PublishTokenRecord | null> => {
      const id = this.publishTokenIdByName.get(name);
      const token = id ? this.publishTokenById.get(id) : undefined;
      return token ? snapshot(token) : null;
    },
    list: async (): Promise<PublishTokenRecord[]> => {
      return snapshotAll([...this.publishTokenById.values()].sort((left, right) =>
        left.name.localeCompare(right.name),
      ));
    },
    save: async (token: PublishTokenRecord): Promise<void> => {
      const existingToken = this.publishTokenById.get(token.id);
      if (existingToken && existingToken.name !== token.name) {
        this.publishTokenIdByName.delete(existingToken.name);
      }

      const existingTokenIdForName = this.publishTokenIdByName.get(token.name);
      if (existingTokenIdForName && existingTokenIdForName !== token.id) {
        this.publishTokenById.delete(existingTokenIdForName);
      }

      this.publishTokenById.set(token.id, snapshot(token));
      this.publishTokenIdByName.set(token.name, token.id);
    },
    deleteByName: async (name: string): Promise<boolean> => {
      const id = this.publishTokenIdByName.get(name);
      if (!id) {
        return false;
      }
      this.publishTokenIdByName.delete(name);
      this.publishTokenById.delete(id);
      return true;
    },
  };

  readonly adminUsers = {
    getById: async (id: string): Promise<AdminUserRecord | null> => {
      const user = this.adminUserById.get(id);
      return user ? snapshot(user) : null;
    },
    getByUsername: async (username: string): Promise<AdminUserRecord | null> => {
      const id = this.adminUserIdByUsername.get(username);
      const user = id ? this.adminUserById.get(id) : undefined;
      return user ? snapshot(user) : null;
    },
    list: async (): Promise<AdminUserRecord[]> => {
      return snapshotAll([...this.adminUserById.values()].sort((left, right) =>
        left.username.localeCompare(right.username),
      ));
    },
    save: async (user: AdminUserRecord): Promise<void> => {
      const existingUser = this.adminUserById.get(user.id);
      if (existingUser && existingUser.username !== user.username) {
        this.adminUserIdByUsername.delete(existingUser.username);
      }

      const existingUserIdForUsername = this.adminUserIdByUsername.get(user.username);
      if (existingUserIdForUsername && existingUserIdForUsername !== user.id) {
        this.adminUserById.delete(existingUserIdForUsername);
      }

      this.adminUserById.set(user.id, snapshot(user));
      this.adminUserIdByUsername.set(user.username, user.id);
    },
  };

  readonly adminRefreshSessions = {
    get: async (id: string): Promise<AdminRefreshSessionRecord | null> => {
      const session = this.adminRefreshSessionById.get(id);
      return session ? snapshot(session) : null;
    },
    list: async (): Promise<AdminRefreshSessionRecord[]> => {
      return snapshotAll([...this.adminRefreshSessionById.values()]).sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt),
      );
    },
    save: async (session: AdminRefreshSessionRecord): Promise<void> => {
      this.adminRefreshSessionById.set(session.id, snapshot(session));
    },
    delete: async (id: string): Promise<boolean> => {
      return this.adminRefreshSessionById.delete(id);
    },
  };

  readonly repositorySecrets = {
    getById: async (id: string): Promise<RepositorySecretRecord | null> => {
      const record = this.repositorySecretById.get(id);
      return record ? snapshot(record) : null;
    },
    getByName: async (name: string, repositoryName: string, namespace: string): Promise<RepositorySecretRecord | null> => {
      const id = this.repositorySecretIdByName.get(repositorySecretNameIndex(namespace, repositoryName, name));
      const stored = id ? this.repositorySecretById.get(id) : undefined;
      return stored ? snapshot(stored) : null;
    },
    list: async (): Promise<RepositorySecretRecord[]> => {
      return snapshotAll([...this.repositorySecretById.values()]).sort((left, right) =>
        left.name.localeCompare(right.name),
      );
    },
    save: async (record: RepositorySecretRecord): Promise<void> => {
      const existing = this.repositorySecretById.get(record.id);
      if (existing) {
        if (
          existing.name !== record.name
          || existing.repositoryName !== record.repositoryName
          || existing.namespace !== record.namespace
        ) {
          this.repositorySecretIdByName.delete(
            repositorySecretNameIndex(existing.namespace, existing.repositoryName, existing.name),
          );
        }
      }

      const nameIndex = repositorySecretNameIndex(record.namespace, record.repositoryName, record.name);
      const existingIdForName = this.repositorySecretIdByName.get(nameIndex);
      if (existingIdForName && existingIdForName !== record.id) {
        this.repositorySecretById.delete(existingIdForName);
      }

      this.repositorySecretById.set(record.id, snapshot(record));
      this.repositorySecretIdByName.set(nameIndex, record.id);
    },
    deleteByRepository: async (repositoryName: string): Promise<number> => {
      let deleted = 0;
      for (const record of [...this.repositorySecretById.values()]) {
        if (record.repositoryName !== repositoryName) continue;
        this.repositorySecretIdByName.delete(
          repositorySecretNameIndex(record.namespace, record.repositoryName, record.name),
        );
        if (this.repositorySecretById.delete(record.id)) {
          deleted++;
        }
      }
      return deleted;
    },
  };

  readonly repositoryPluginPolicies = {
    getByEcosystem: async (ecosystem: string): Promise<RepositoryPluginPolicyRecord | null> => {
      const record = this.repositoryPluginPolicyByEcosystem.get(ecosystem);
      return record ? snapshot(record) : null;
    },
    list: async (): Promise<RepositoryPluginPolicyRecord[]> => {
      return snapshotAll([...this.repositoryPluginPolicyByEcosystem.values()]).sort((left, right) =>
        left.ecosystem.localeCompare(right.ecosystem),
      );
    },
    save: async (record: RepositoryPluginPolicyRecord): Promise<void> => {
      this.repositoryPluginPolicyByEcosystem.set(record.ecosystem, snapshot(record));
    },
  };

  readonly runtimeSettings = {
    get: async (): Promise<RuntimeSettingsRecord | null> => {
      return this.runtimeSettingsRecord ? snapshot(this.runtimeSettingsRecord) : null;
    },
    save: async (record: RuntimeSettingsRecord): Promise<void> => {
      this.runtimeSettingsRecord = snapshot(record);
    },
  };

  readonly repositoryActivities = {
    listByRepository: async (repositoryName: string): Promise<RepositoryActivityRecord[]> => {
      return snapshotAll([...this.repositoryActivityById.values()])
        .filter((activity) => activity.repositoryName === repositoryName)
        .sort(compareRepositoryActivities);
    },
    save: async (record: RepositoryActivityRecord): Promise<void> => {
      this.repositoryActivityById.set(record.id, snapshot(record));
    },
    deleteByRepository: async (repositoryName: string): Promise<number> => {
      let deleted = 0;
      for (const activity of [...this.repositoryActivityById.values()]) {
        if (activity.repositoryName !== repositoryName) continue;
        if (this.repositoryActivityById.delete(activity.id)) {
          deleted++;
        }
      }
      return deleted;
    },
  };

  readonly repositoryArtifacts = {
    getById: async (id: string): Promise<RepositoryArtifactRecord | null> => {
      const record = this.repositoryArtifactById.get(id);
      return record ? snapshot(record) : null;
    },
    countByRepository: async (repositoryName: string): Promise<number> => {
      let count = 0;
      for (const artifact of this.repositoryArtifactById.values()) {
        if (artifact.repositoryName === repositoryName) count += 1;
      }
      return count;
    },
    listByRepository: async (repositoryName: string): Promise<RepositoryArtifactRecord[]> => {
      return snapshotAll([...this.repositoryArtifactById.values()])
        .filter((artifact) => artifact.repositoryName === repositoryName)
        .sort(compareRepositoryArtifacts);
    },
    listFamiliesByRepositoryPage: async (
      repositoryName: string,
      page: { limit: number; offset: number },
    ): Promise<{ records: RepositoryArtifactFamilyRecord[]; totalFamilies: number; totalArtifacts: number }> => {
      const artifacts = await this.repositoryArtifacts.listByRepository(repositoryName);
      const families = repositoryArtifactFamilies(artifacts);
      return {
        records: families.slice(page.offset, page.offset + page.limit),
        totalFamilies: families.length,
        totalArtifacts: artifacts.length,
      };
    },
    listByRepositoryPage: async (
      repositoryName: string,
      page: { limit: number; offset: number },
    ): Promise<{ records: RepositoryArtifactRecord[]; total: number }> => {
      const records = await this.repositoryArtifacts.listByRepository(repositoryName);
      return {
        records: records.slice(page.offset, page.offset + page.limit),
        total: records.length,
      };
    },
    listByRepositoryFamily: async (repositoryName: string, family: string): Promise<RepositoryArtifactRecord[]> => {
      return (await this.repositoryArtifacts.listByRepository(repositoryName))
        .filter((artifact) => (artifact.family ?? artifact.id) === family);
    },
    upsert: async (record: RepositoryArtifactRecord): Promise<void> => {
      const identityIndex = repositoryArtifactIdentityIndex(record.repositoryName, record.identity);
      const existingId = this.repositoryArtifactIdByIdentity.get(identityIndex);
      if (existingId && existingId !== record.id) {
        this.repositoryArtifactById.delete(existingId);
      }
      const existing = this.repositoryArtifactById.get(record.id);
      if (existing) {
        this.repositoryArtifactIdByIdentity.delete(
          repositoryArtifactIdentityIndex(existing.repositoryName, existing.identity),
        );
      }
      this.repositoryArtifactById.set(record.id, snapshot(record));
      this.repositoryArtifactIdByIdentity.set(identityIndex, record.id);
    },
    upsertMany: async (records: RepositoryArtifactRecord[]): Promise<void> => {
      for (const record of records) {
        await this.repositoryArtifacts.upsert(record);
      }
    },
    replaceByRepository: async (repositoryName: string, records: RepositoryArtifactRecord[]): Promise<void> => {
      for (const artifact of [...this.repositoryArtifactById.values()]) {
        if (artifact.repositoryName !== repositoryName) continue;
        this.repositoryArtifactById.delete(artifact.id);
        this.repositoryArtifactIdByIdentity.delete(repositoryArtifactIdentityIndex(artifact.repositoryName, artifact.identity));
      }
      await this.repositoryArtifacts.upsertMany(records);
    },
  };

  readonly backgroundJobs = {
    get: async (id: string): Promise<BackgroundJobRecord | null> => {
      const record = this.backgroundJobById.get(id);
      return record ? snapshot(record) : null;
    },
    list: async (query: {
      repositoryName?: string;
      status?: BackgroundJobRecord["status"];
      type?: BackgroundJobRecord["type"];
      limit?: number;
      offset?: number;
    } = {}): Promise<{ jobs: BackgroundJobRecord[]; total: number }> => {
      const filtered = snapshotAll([...this.backgroundJobById.values()])
        .filter((job) => query.repositoryName === undefined || job.repositoryName === query.repositoryName)
        .filter((job) => query.status === undefined || job.status === query.status)
        .filter((job) => query.type === undefined || job.type === query.type)
        .sort(compareBackgroundJobs);
      const offset = query.offset ?? 0;
      const limit = query.limit ?? filtered.length;
      return { jobs: filtered.slice(offset, offset + limit), total: filtered.length };
    },
    listRunnable: async (input: { limit: number }): Promise<BackgroundJobRecord[]> => {
      return snapshotAll([...this.backgroundJobById.values()])
        .filter((job) => isRunnableBackgroundJob(job, new Date().toISOString()))
        .sort(compareRunnableBackgroundJobs)
        .slice(0, input.limit);
    },
    acquireRunnable: async (input: {
      leaseId: string;
      leaseExpiresAt: string;
      now: string;
    }): Promise<BackgroundJobRecord | null> => {
      const candidate = snapshotAll([...this.backgroundJobById.values()])
        .filter((job) => isRunnableBackgroundJob(job, input.now))
        .sort(compareRunnableBackgroundJobs)[0];
      if (!candidate) return null;
      const leased: BackgroundJobRecord = {
        ...candidate,
        status: "running",
        startedAt: candidate.startedAt ?? input.now,
        lastHeartbeatAt: input.now,
        leaseId: input.leaseId,
        leaseExpiresAt: input.leaseExpiresAt,
      };
      this.backgroundJobById.set(leased.id, snapshot(leased));
      return snapshot(leased);
    },
    save: async (record: BackgroundJobRecord): Promise<void> => {
      this.backgroundJobById.set(record.id, snapshot(record));
    },
    cancel: async (id: string, requestedAt: string): Promise<BackgroundJobRecord | null> => {
      const existing = this.backgroundJobById.get(id);
      if (!existing) return null;
      const canceled: BackgroundJobRecord = existing.status === "pending"
        ? {
          ...existing,
          status: "canceled",
          cancelRequestedAt: requestedAt,
          finishedAt: requestedAt,
        }
        : existing.status === "running"
          ? {
            ...existing,
            status: "canceling",
            cancelRequestedAt: requestedAt,
          }
          : existing;
      this.backgroundJobById.set(id, snapshot(canceled));
      return snapshot(canceled);
    },
    deleteBySubject: async (subject: { type: string; id: string }): Promise<number> => {
      let deleted = 0;
      for (const [id, job] of this.backgroundJobById.entries()) {
        if (job.subject.type !== subject.type || job.subject.id !== subject.id) continue;
        this.backgroundJobById.delete(id);
        deleted += 1;
      }
      return deleted;
    },
    deleteByRepository: async (repositoryName: string): Promise<number> => {
      let deleted = 0;
      for (const [id, job] of this.backgroundJobById.entries()) {
        if (job.repositoryName !== repositoryName) continue;
        this.backgroundJobById.delete(id);
        deleted += 1;
      }
      return deleted;
    },
  };

}

function comparePublishSessions(left: PublishSession, right: PublishSession): number {
  const createdAtOrder = right.createdAt.localeCompare(left.createdAt);
  return createdAtOrder === 0 ? left.id.localeCompare(right.id) : createdAtOrder;
}

function compareBackgroundJobs(left: BackgroundJobRecord, right: BackgroundJobRecord): number {
  const requestedAtOrder = right.requestedAt.localeCompare(left.requestedAt);
  return requestedAtOrder === 0 ? left.id.localeCompare(right.id) : requestedAtOrder;
}

function compareRunnableBackgroundJobs(left: BackgroundJobRecord, right: BackgroundJobRecord): number {
  const priorityOrder = right.priority - left.priority;
  if (priorityOrder !== 0) return priorityOrder;
  const scheduledAtOrder = left.scheduledAt.localeCompare(right.scheduledAt);
  return scheduledAtOrder === 0 ? left.id.localeCompare(right.id) : scheduledAtOrder;
}

function isRunnableBackgroundJob(job: BackgroundJobRecord, now: string): boolean {
  return job.status === "pending" || (job.status === "running" && job.leaseExpiresAt !== undefined && job.leaseExpiresAt < now);
}

function compareRepositoryActivities(left: RepositoryActivityRecord, right: RepositoryActivityRecord): number {
  const createdAtOrder = right.createdAt.localeCompare(left.createdAt);
  return createdAtOrder === 0 ? left.id.localeCompare(right.id) : createdAtOrder;
}

function compareRepositoryArtifacts(left: RepositoryArtifactRecord, right: RepositoryArtifactRecord): number {
  const updatedAtOrder = right.updatedAt.localeCompare(left.updatedAt);
  return updatedAtOrder === 0 ? left.id.localeCompare(right.id) : updatedAtOrder;
}

function repositoryArtifactFamilies(artifacts: RepositoryArtifactRecord[]): RepositoryArtifactFamilyRecord[] {
  const byFamily = new Map<string, RepositoryArtifactRecord[]>();
  for (const artifact of artifacts) {
    const key = artifact.family ?? artifact.id;
    byFamily.set(key, [...(byFamily.get(key) ?? []), artifact]);
  }
  return [...byFamily.entries()]
    .map(([key, members]) => {
      const ordered = [...members].sort(compareRepositoryArtifacts);
      const latestArtifact = ordered.find((artifact) => artifact.version !== undefined) ?? ordered[0]!;
      const latestMember = ordered[0]!;
      const versions = new Set(ordered.flatMap((artifact) =>
        artifact.version === undefined ? [] : [artifact.version]));
      return {
        key,
        repositoryName: latestArtifact.repositoryName,
        ecosystem: latestArtifact.ecosystem,
        name: latestArtifact.name,
        ...(latestArtifact.version === undefined ? {} : { latestVersion: latestArtifact.version }),
        latestSummary: latestArtifact.summary,
        latestPublishedAt: latestArtifact.publishedAt,
        updatedAt: latestMember.updatedAt,
        artifactCount: ordered.length,
        versionCount: versions.size,
        latestArtifact,
      };
    })
    .sort((left, right) => {
      const updatedAtOrder = right.updatedAt.localeCompare(left.updatedAt);
      return updatedAtOrder === 0 ? left.key.localeCompare(right.key) : updatedAtOrder;
    });
}

function repositoryArtifactIdentityIndex(repositoryName: string, identity: string): string {
  return `${repositoryName}\0${identity}`;
}

function repositorySecretNameIndex(namespace: string, repositoryName: string, name: string): string {
  return `${namespace}\0${repositoryName}\0${name}`;
}

