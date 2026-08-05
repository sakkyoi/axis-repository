import type {
  PublishSession,
  PublishTokenRecord,
  AdminUserRecord,
  AdminRefreshSessionRecord,
  Repository,
  RepositoryArtifactRecord,
  RepositoryArtifactFamilyRecord,
  RepositoryActivityRecord,
  PublishFinalizeJobRecord,
  RepositoryIndexJobRecord,
  BackgroundJobRecord,
  RepositorySecretRecord,
  RepositoryPluginPolicyRecord,
  SigningKeyRecord,
  StateStore,
} from "@axis-repository/core";

export interface DurableStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T>(options?: { prefix?: string }): Promise<Map<string, T>>;
}

const repositoryKey = (name: string) => `repository:${name}`;
const sessionKey = (id: string) => `publish-session:${id}`;
const tokenKey = (id: string) => `publish-token:${id}`;
const tokenNameKey = (name: string) => `publish-token-name:${name}`;
const adminUserKey = (id: string) => `admin-user:${id}`;
const adminUserUsernameKey = (username: string) => `admin-user-username:${username}`;
const adminRefreshSessionKey = (id: string) => `admin-refresh-session:${id}`;
const signingKeyKey = (id: string) => `signing-key:${id}`;
const signingKeyNameKey = (repositoryName: string, name: string) => `signing-key-name:${repositoryName}:${name}`;
const repositorySecretKey = (id: string) => `repository-secret:${id}`;
const repositorySecretNameKey = (namespace: string, repositoryName: string, name: string) =>
  `repository-secret-name:${namespace}:${repositoryName}:${name}`;
const repositoryPluginPolicyKey = (ecosystem: string) => `repository-plugin-policy:${ecosystem}`;
const repositoryActivityKey = (id: string) => `repository-activity:${id}`;
const repositoryArtifactKey = (id: string) => `repository-artifact:${id}`;
const repositoryArtifactIdentityKey = (repositoryName: string, identity: string) =>
  `repository-artifact-identity:${repositoryName}:${identity}`;
const backgroundJobKey = (id: string) => `background-job:${id}`;
const publishFinalizeJobKey = (sessionId: string) => `publish-finalize-job:${sessionId}`;
const repositoryIndexJobKey = (repositoryName: string) => `repository-index-job:${repositoryName}`;

function clonePublishSession(session: PublishSession): PublishSession {
  return JSON.parse(JSON.stringify(session)) as PublishSession;
}

export class DurableStateStore implements StateStore {
  private sessionMutation = Promise.resolve();

  constructor(private readonly storage: DurableStorage) {}

  private async withSessionMutation<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.sessionMutation.then(fn, fn);
    this.sessionMutation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  readonly repositories = {
    getByName: async (name: string): Promise<Repository | null> => {
      return (await this.storage.get<Repository>(repositoryKey(name))) ?? null;
    },
    list: async (): Promise<Repository[]> => {
      const values = await this.storage.list<Repository>({ prefix: "repository:" });
      return [...values.values()].sort((left, right) =>
        left.name.localeCompare(right.name),
      );
    },
    save: async (repository: Repository): Promise<void> => {
      await this.storage.put(repositoryKey(repository.name), repository);
    },
    deleteByName: async (name: string): Promise<boolean> => {
      return this.storage.delete(repositoryKey(name));
    },
  };

  readonly publishSessions = {
    get: async (id: string): Promise<PublishSession | null> => {
      return (await this.storage.get<PublishSession>(sessionKey(id))) ?? null;
    },
    list: async (): Promise<PublishSession[]> => {
      const values = await this.storage.list<PublishSession>({
        prefix: "publish-session:",
      });
      return [...values.values()].sort(comparePublishSessions);
    },
    save: async (session: PublishSession): Promise<void> => {
      await this.storage.put(sessionKey(session.id), session);
    },
    deleteByRepository: async (repositoryName: string): Promise<number> => {
      const values = await this.storage.list<PublishSession>({
        prefix: "publish-session:",
      });
      let deleted = 0;
      for (const session of values.values()) {
        if (session.repositoryName !== repositoryName) continue;
        if (await this.storage.delete(sessionKey(session.id))) {
          deleted++;
        }
      }
      return deleted;
    },
    update: async (
      id: string,
      updater: (current: PublishSession) => PublishSession,
    ): Promise<PublishSession | null> => {
      return this.withSessionMutation(async () => {
        const current = (await this.storage.get<PublishSession>(sessionKey(id))) ?? null;
        if (!current) {
          return null;
        }
        const updated = updater(clonePublishSession(current));
        await this.storage.put(sessionKey(id), updated);
        return updated;
      });
    },
  };

  readonly backgroundJobs = {
    get: async (id: string): Promise<BackgroundJobRecord | null> => {
      return (await this.storage.get<BackgroundJobRecord>(backgroundJobKey(id))) ?? null;
    },
    list: async (query: {
      repositoryName?: string;
      status?: BackgroundJobRecord["status"];
      type?: BackgroundJobRecord["type"];
      limit?: number;
      offset?: number;
    } = {}): Promise<{ jobs: BackgroundJobRecord[]; total: number }> => {
      const values = await this.storage.list<BackgroundJobRecord>({
        prefix: "background-job:",
      });
      const filtered = [...values.values()]
        .filter((job) => query.repositoryName === undefined || job.repositoryName === query.repositoryName)
        .filter((job) => query.status === undefined || job.status === query.status)
        .filter((job) => query.type === undefined || job.type === query.type)
        .sort(compareBackgroundJobs);
      const offset = query.offset ?? 0;
      const limit = query.limit ?? filtered.length;
      return { jobs: filtered.slice(offset, offset + limit), total: filtered.length };
    },
    listRunnable: async (input: { limit: number }): Promise<BackgroundJobRecord[]> => {
      const values = await this.storage.list<BackgroundJobRecord>({
        prefix: "background-job:",
      });
      return [...values.values()]
        .filter((job) => job.status === "pending")
        .sort(compareRunnableBackgroundJobs)
        .slice(0, input.limit);
    },
    save: async (record: BackgroundJobRecord): Promise<void> => {
      await this.storage.put(backgroundJobKey(record.id), record);
    },
    cancel: async (id: string, requestedAt: string): Promise<BackgroundJobRecord | null> => {
      const existing = (await this.storage.get<BackgroundJobRecord>(backgroundJobKey(id))) ?? null;
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
      await this.storage.put(backgroundJobKey(id), canceled);
      return canceled;
    },
    deleteBySubject: async (subject: { type: string; id: string }): Promise<number> => {
      const values = await this.storage.list<BackgroundJobRecord>({
        prefix: "background-job:",
      });
      let deleted = 0;
      for (const job of values.values()) {
        if (job.subject.type !== subject.type || job.subject.id !== subject.id) continue;
        if (await this.storage.delete(backgroundJobKey(job.id))) {
          deleted++;
        }
      }
      return deleted;
    },
    deleteByRepository: async (repositoryName: string): Promise<number> => {
      const values = await this.storage.list<BackgroundJobRecord>({
        prefix: "background-job:",
      });
      let deleted = 0;
      for (const job of values.values()) {
        if (job.repositoryName !== repositoryName) continue;
        if (await this.storage.delete(backgroundJobKey(job.id))) {
          deleted++;
        }
      }
      return deleted;
    },
  };

  readonly publishFinalizeJobs = {
    getBySession: async (sessionId: string): Promise<PublishFinalizeJobRecord | null> => {
      return (await this.storage.get<PublishFinalizeJobRecord>(publishFinalizeJobKey(sessionId))) ?? null;
    },
    listRunnable: async (): Promise<PublishFinalizeJobRecord[]> => {
      const values = await this.storage.list<PublishFinalizeJobRecord>({
        prefix: "publish-finalize-job:",
      });
      return [...values.values()]
        .filter((job) => job.status === "pending")
        .sort(comparePublishFinalizeJobs);
    },
    save: async (record: PublishFinalizeJobRecord): Promise<void> => {
      await this.storage.put(publishFinalizeJobKey(record.sessionId), record);
    },
    deleteBySession: async (sessionId: string): Promise<boolean> => {
      return this.storage.delete(publishFinalizeJobKey(sessionId));
    },
    deleteByRepository: async (repositoryName: string): Promise<number> => {
      const values = await this.storage.list<PublishFinalizeJobRecord>({
        prefix: "publish-finalize-job:",
      });
      let deleted = 0;
      for (const job of values.values()) {
        if (job.repositoryName !== repositoryName) continue;
        if (await this.storage.delete(publishFinalizeJobKey(job.sessionId))) {
          deleted++;
        }
      }
      return deleted;
    },
  };

  readonly publishTokens = {
    getById: async (id: string): Promise<PublishTokenRecord | null> => {
      return (await this.storage.get<PublishTokenRecord>(tokenKey(id))) ?? null;
    },
    getByName: async (name: string): Promise<PublishTokenRecord | null> => {
      const id = await this.storage.get<string>(tokenNameKey(name));
      return id
        ? ((await this.storage.get<PublishTokenRecord>(tokenKey(id))) ?? null)
        : null;
    },
    list: async (): Promise<PublishTokenRecord[]> => {
      const values = await this.storage.list<PublishTokenRecord>({
        prefix: "publish-token:",
      });
      return [...values.values()].sort((left, right) =>
        left.name.localeCompare(right.name),
      );
    },
    save: async (token: PublishTokenRecord): Promise<void> => {
      const existing = await this.storage.get<PublishTokenRecord>(tokenKey(token.id));
      if (existing && existing.name !== token.name) {
        await this.storage.delete(tokenNameKey(existing.name));
      }

      const existingIdForName = await this.storage.get<string>(
        tokenNameKey(token.name),
      );
      if (existingIdForName && existingIdForName !== token.id) {
        await this.storage.delete(tokenKey(existingIdForName));
      }

      await this.storage.put(tokenKey(token.id), token);
      await this.storage.put(tokenNameKey(token.name), token.id);
    },
    deleteByName: async (name: string): Promise<boolean> => {
      const id = await this.storage.get<string>(tokenNameKey(name));
      if (!id) {
        return false;
      }
      await this.storage.delete(tokenNameKey(name));
      await this.storage.delete(tokenKey(id));
      return true;
    },
  };

  readonly adminUsers = {
    getById: async (id: string): Promise<AdminUserRecord | null> => {
      return (await this.storage.get<AdminUserRecord>(adminUserKey(id))) ?? null;
    },
    getByUsername: async (username: string): Promise<AdminUserRecord | null> => {
      const id = await this.storage.get<string>(adminUserUsernameKey(username));
      return id ? ((await this.storage.get<AdminUserRecord>(adminUserKey(id))) ?? null) : null;
    },
    list: async (): Promise<AdminUserRecord[]> => {
      const values = await this.storage.list<AdminUserRecord>({
        prefix: "admin-user:",
      });
      return [...values.values()].sort((left, right) =>
        left.username.localeCompare(right.username),
      );
    },
    save: async (user: AdminUserRecord): Promise<void> => {
      const existing = await this.storage.get<AdminUserRecord>(adminUserKey(user.id));
      if (existing && existing.username !== user.username) {
        await this.storage.delete(adminUserUsernameKey(existing.username));
      }

      const existingIdForUsername = await this.storage.get<string>(adminUserUsernameKey(user.username));
      if (existingIdForUsername && existingIdForUsername !== user.id) {
        await this.storage.delete(adminUserKey(existingIdForUsername));
      }

      await this.storage.put(adminUserKey(user.id), user);
      await this.storage.put(adminUserUsernameKey(user.username), user.id);
    },
  };

  readonly adminRefreshSessions = {
    get: async (id: string): Promise<AdminRefreshSessionRecord | null> => {
      return (await this.storage.get<AdminRefreshSessionRecord>(adminRefreshSessionKey(id))) ?? null;
    },
    list: async (): Promise<AdminRefreshSessionRecord[]> => {
      const values = await this.storage.list<AdminRefreshSessionRecord>({
        prefix: "admin-refresh-session:",
      });
      return [...values.values()].sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt),
      );
    },
    save: async (session: AdminRefreshSessionRecord): Promise<void> => {
      await this.storage.put(adminRefreshSessionKey(session.id), session);
    },
    delete: async (id: string): Promise<boolean> => {
      return this.storage.delete(adminRefreshSessionKey(id));
    },
  };

  readonly repositorySecrets = {
    getById: async (id: string): Promise<RepositorySecretRecord | SigningKeyRecord | null> => {
      return (
        (await this.storage.get<RepositorySecretRecord>(repositorySecretKey(id)))
        ?? (await this.storage.get<SigningKeyRecord>(signingKeyKey(id)))
        ?? null
      );
    },
    getByName: async (
      name: string,
      repositoryName: string,
      namespace: string,
    ): Promise<RepositorySecretRecord | null> => {
      const id = await this.storage.get<string>(repositorySecretNameKey(namespace, repositoryName, name));
      return id
        ? ((await this.storage.get<RepositorySecretRecord>(repositorySecretKey(id))) ?? null)
        : null;
    },
    list: async (): Promise<Array<RepositorySecretRecord | SigningKeyRecord>> => {
      const values = await this.storage.list<RepositorySecretRecord>({
        prefix: "repository-secret:",
      });
      const legacyValues = await this.storage.list<SigningKeyRecord>({
        prefix: "signing-key:",
      });
      return [...values.values(), ...legacyValues.values()].sort((left, right) =>
        left.name.localeCompare(right.name),
      );
    },
    save: async (record: RepositorySecretRecord): Promise<void> => {
      const existing = await this.storage.get<RepositorySecretRecord>(
        repositorySecretKey(record.id),
      );
      if (
        existing
        && (existing.name !== record.name
          || existing.repositoryName !== record.repositoryName
          || existing.namespace !== record.namespace)
      ) {
        await this.storage.delete(repositorySecretNameKey(existing.namespace, existing.repositoryName, existing.name));
      }

      const existingIdForName = await this.storage.get<string>(
        repositorySecretNameKey(record.namespace, record.repositoryName, record.name),
      );
      if (existingIdForName && existingIdForName !== record.id) {
        await this.storage.delete(repositorySecretKey(existingIdForName));
      }

      await this.storage.put(repositorySecretKey(record.id), record);
      await this.storage.put(repositorySecretNameKey(record.namespace, record.repositoryName, record.name), record.id);
    },
    deleteByRepository: async (repositoryName: string): Promise<number> => {
      let deleted = 0;
      const values = await this.storage.list<RepositorySecretRecord>({
        prefix: "repository-secret:",
      });
      for (const record of values.values()) {
        if (record.repositoryName !== repositoryName) continue;
        await this.storage.delete(repositorySecretNameKey(record.namespace, record.repositoryName, record.name));
        if (await this.storage.delete(repositorySecretKey(record.id))) {
          deleted++;
        }
      }

      const legacyValues = await this.storage.list<SigningKeyRecord>({
        prefix: "signing-key:",
      });
      for (const record of legacyValues.values()) {
        if (record.repositoryName !== repositoryName) continue;
        await this.storage.delete(signingKeyNameKey(record.repositoryName, record.name));
        if (await this.storage.delete(signingKeyKey(record.id))) {
          deleted++;
        }
      }
      return deleted;
    },
  };

  readonly repositoryPluginPolicies = {
    getByEcosystem: async (ecosystem: string): Promise<RepositoryPluginPolicyRecord | null> => {
      return (await this.storage.get<RepositoryPluginPolicyRecord>(repositoryPluginPolicyKey(ecosystem))) ?? null;
    },
    list: async (): Promise<RepositoryPluginPolicyRecord[]> => {
      const values = await this.storage.list<RepositoryPluginPolicyRecord>({
        prefix: "repository-plugin-policy:",
      });
      return [...values.values()].sort((left, right) =>
        left.ecosystem.localeCompare(right.ecosystem),
      );
    },
    save: async (record: RepositoryPluginPolicyRecord): Promise<void> => {
      await this.storage.put(repositoryPluginPolicyKey(record.ecosystem), record);
    },
  };

  readonly repositoryActivities = {
    listByRepository: async (repositoryName: string): Promise<RepositoryActivityRecord[]> => {
      const values = await this.storage.list<RepositoryActivityRecord>({
        prefix: "repository-activity:",
      });
      return [...values.values()]
        .filter((activity) => activity.repositoryName === repositoryName)
        .sort(compareRepositoryActivities);
    },
    save: async (record: RepositoryActivityRecord): Promise<void> => {
      await this.storage.put(repositoryActivityKey(record.id), record);
    },
    deleteByRepository: async (repositoryName: string): Promise<number> => {
      const values = await this.storage.list<RepositoryActivityRecord>({
        prefix: "repository-activity:",
      });
      let deleted = 0;
      for (const activity of values.values()) {
        if (activity.repositoryName !== repositoryName) continue;
        if (await this.storage.delete(repositoryActivityKey(activity.id))) {
          deleted++;
        }
      }
      return deleted;
    },
  };

  readonly repositoryArtifacts = {
    listByRepository: async (repositoryName: string): Promise<RepositoryArtifactRecord[]> => {
      const values = await this.storage.list<RepositoryArtifactRecord>({
        prefix: "repository-artifact:",
      });
      return [...values.values()]
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
      const identityKey = repositoryArtifactIdentityKey(record.repositoryName, record.identity);
      const existingId = await this.storage.get<string>(identityKey);
      if (existingId && existingId !== record.id) {
        await this.storage.delete(repositoryArtifactKey(existingId));
      }
      const existing = await this.storage.get<RepositoryArtifactRecord>(repositoryArtifactKey(record.id));
      if (existing) {
        await this.storage.delete(repositoryArtifactIdentityKey(existing.repositoryName, existing.identity));
      }
      await this.storage.put(repositoryArtifactKey(record.id), record);
      await this.storage.put(identityKey, record.id);
    },
    replaceByRepository: async (repositoryName: string, records: RepositoryArtifactRecord[]): Promise<void> => {
      const values = await this.storage.list<RepositoryArtifactRecord>({
        prefix: "repository-artifact:",
      });
      for (const artifact of values.values()) {
        if (artifact.repositoryName !== repositoryName) continue;
        await this.storage.delete(repositoryArtifactKey(artifact.id));
        await this.storage.delete(repositoryArtifactIdentityKey(artifact.repositoryName, artifact.identity));
      }
      for (const record of records) {
        await this.repositoryArtifacts.upsert(record);
      }
    },
  };

  readonly repositoryIndexJobs = {
    getByRepository: async (repositoryName: string): Promise<RepositoryIndexJobRecord | null> => {
      return (await this.storage.get<RepositoryIndexJobRecord>(repositoryIndexJobKey(repositoryName))) ?? null;
    },
    listRunnable: async (): Promise<RepositoryIndexJobRecord[]> => {
      const values = await this.storage.list<RepositoryIndexJobRecord>({
        prefix: "repository-index-job:",
      });
      return [...values.values()]
        .filter((job) => job.status === "pending")
        .sort(compareRepositoryIndexJobs);
    },
    save: async (record: RepositoryIndexJobRecord): Promise<void> => {
      await this.storage.put(repositoryIndexJobKey(record.repositoryName), record);
    },
    deleteByRepository: async (repositoryName: string): Promise<boolean> => {
      return this.storage.delete(repositoryIndexJobKey(repositoryName));
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

function comparePublishFinalizeJobs(left: PublishFinalizeJobRecord, right: PublishFinalizeJobRecord): number {
  const requestedAtOrder = left.requestedAt.localeCompare(right.requestedAt);
  return requestedAtOrder === 0 ? left.sessionId.localeCompare(right.sessionId) : requestedAtOrder;
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
      const latestArtifact = ordered[0]!;
      const versions = new Set(ordered.map((artifact) => artifact.version ?? ""));
      return {
        key,
        repositoryName: latestArtifact.repositoryName,
        ecosystem: latestArtifact.ecosystem,
        name: latestArtifact.name,
        ...(latestArtifact.version === undefined ? {} : { latestVersion: latestArtifact.version }),
        latestSummary: latestArtifact.summary,
        latestPublishedAt: latestArtifact.publishedAt,
        updatedAt: latestArtifact.updatedAt,
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

function compareRepositoryIndexJobs(left: RepositoryIndexJobRecord, right: RepositoryIndexJobRecord): number {
  const requestedAtOrder = left.requestedAt.localeCompare(right.requestedAt);
  return requestedAtOrder === 0 ? left.repositoryName.localeCompare(right.repositoryName) : requestedAtOrder;
}
