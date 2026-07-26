import type {
  PublishSession,
  PublishTokenRecord,
  AdminUserRecord,
  AdminRefreshSessionRecord,
  Repository,
  RepositoryArtifactRecord,
  RepositoryActivityRecord,
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
}

function comparePublishSessions(left: PublishSession, right: PublishSession): number {
  const createdAtOrder = right.createdAt.localeCompare(left.createdAt);
  return createdAtOrder === 0 ? left.id.localeCompare(right.id) : createdAtOrder;
}

function compareRepositoryActivities(left: RepositoryActivityRecord, right: RepositoryActivityRecord): number {
  const createdAtOrder = right.createdAt.localeCompare(left.createdAt);
  return createdAtOrder === 0 ? left.id.localeCompare(right.id) : createdAtOrder;
}

function compareRepositoryArtifacts(left: RepositoryArtifactRecord, right: RepositoryArtifactRecord): number {
  const updatedAtOrder = right.updatedAt.localeCompare(left.updatedAt);
  return updatedAtOrder === 0 ? left.id.localeCompare(right.id) : updatedAtOrder;
}
