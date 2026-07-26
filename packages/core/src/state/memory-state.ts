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
} from "../domain/domain";
import type { StateStore } from "../ports/ports";

function clonePublishSession(session: PublishSession): PublishSession {
  return JSON.parse(JSON.stringify(session)) as PublishSession;
}

export class MemoryStateStore implements StateStore {
  private readonly repositoryByName = new Map<string, Repository>();
  private readonly publishSessionById = new Map<string, PublishSession>();
  private readonly publishTokenById = new Map<string, PublishTokenRecord>();
  private readonly adminUserById = new Map<string, AdminUserRecord>();
  private readonly adminUserIdByUsername = new Map<string, string>();
  private readonly adminRefreshSessionById = new Map<string, AdminRefreshSessionRecord>();
  private readonly publishTokenIdByName = new Map<string, string>();
  private readonly repositorySecretById = new Map<string, RepositorySecretRecord | SigningKeyRecord>();
  private readonly repositorySecretIdByName = new Map<string, string>();
  private readonly repositoryPluginPolicyByEcosystem = new Map<string, RepositoryPluginPolicyRecord>();
  private readonly repositoryActivityById = new Map<string, RepositoryActivityRecord>();
  private readonly repositoryArtifactById = new Map<string, RepositoryArtifactRecord>();
  private readonly repositoryArtifactIdByIdentity = new Map<string, string>();

  readonly repositories = {
    getByName: async (name: string): Promise<Repository | null> => {
      return this.repositoryByName.get(name) ?? null;
    },
    list: async (): Promise<Repository[]> => {
      return [...this.repositoryByName.values()].sort((left, right) =>
        left.name.localeCompare(right.name),
      );
    },
    save: async (repository: Repository): Promise<void> => {
      this.repositoryByName.set(repository.name, repository);
    },
    deleteByName: async (name: string): Promise<boolean> => {
      return this.repositoryByName.delete(name);
    },
  };

  readonly publishSessions = {
    get: async (id: string): Promise<PublishSession | null> => {
      return this.publishSessionById.get(id) ?? null;
    },
    list: async (): Promise<PublishSession[]> => {
      return [...this.publishSessionById.values()].sort(comparePublishSessions);
    },
    save: async (session: PublishSession): Promise<void> => {
      this.publishSessionById.set(session.id, session);
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
      const updated = updater(clonePublishSession(current));
      this.publishSessionById.set(id, updated);
      return updated;
    },
    compareAndSetStatus: async (
      id: string,
      expectedStatus: PublishSession["status"],
      session: PublishSession,
    ): Promise<boolean> => {
      if (session.id !== id) {
        return false;
      }
      const current = this.publishSessionById.get(id);
      if (!current || current.status !== expectedStatus) {
        return false;
      }
      this.publishSessionById.set(id, session);
      return true;
    },
  };

  readonly publishTokens = {
    getById: async (id: string): Promise<PublishTokenRecord | null> => {
      return this.publishTokenById.get(id) ?? null;
    },
    getByName: async (name: string): Promise<PublishTokenRecord | null> => {
      const id = this.publishTokenIdByName.get(name);
      return id ? this.publishTokenById.get(id) ?? null : null;
    },
    list: async (): Promise<PublishTokenRecord[]> => {
      return [...this.publishTokenById.values()].sort((left, right) =>
        left.name.localeCompare(right.name),
      );
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

      this.publishTokenById.set(token.id, token);
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
      return this.adminUserById.get(id) ?? null;
    },
    getByUsername: async (username: string): Promise<AdminUserRecord | null> => {
      const id = this.adminUserIdByUsername.get(username);
      return id ? this.adminUserById.get(id) ?? null : null;
    },
    list: async (): Promise<AdminUserRecord[]> => {
      return [...this.adminUserById.values()].sort((left, right) =>
        left.username.localeCompare(right.username),
      );
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

      this.adminUserById.set(user.id, user);
      this.adminUserIdByUsername.set(user.username, user.id);
    },
  };

  readonly adminRefreshSessions = {
    get: async (id: string): Promise<AdminRefreshSessionRecord | null> => {
      return this.adminRefreshSessionById.get(id) ?? null;
    },
    list: async (): Promise<AdminRefreshSessionRecord[]> => {
      return [...this.adminRefreshSessionById.values()].sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt),
      );
    },
    save: async (session: AdminRefreshSessionRecord): Promise<void> => {
      this.adminRefreshSessionById.set(session.id, session);
    },
  };

  readonly repositorySecrets = {
    getById: async (id: string): Promise<RepositorySecretRecord | SigningKeyRecord | null> => {
      return this.repositorySecretById.get(id) ?? null;
    },
    getByName: async (name: string, repositoryName: string, namespace: string): Promise<RepositorySecretRecord | null> => {
      const id = this.repositorySecretIdByName.get(repositorySecretNameIndex(namespace, repositoryName, name));
      const record = id ? this.repositorySecretById.get(id) ?? null : null;
      return record && isRepositorySecretRecord(record) ? record : null;
    },
    list: async (): Promise<Array<RepositorySecretRecord | SigningKeyRecord>> => {
      return [...this.repositorySecretById.values()].sort((left, right) =>
        left.name.localeCompare(right.name),
      );
    },
    save: async (record: RepositorySecretRecord): Promise<void> => {
      const existing = this.repositorySecretById.get(record.id);
      if (existing && isRepositorySecretRecord(existing)) {
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

      this.repositorySecretById.set(record.id, record);
      this.repositorySecretIdByName.set(nameIndex, record.id);
    },
    deleteByRepository: async (repositoryName: string): Promise<number> => {
      let deleted = 0;
      for (const record of [...this.repositorySecretById.values()]) {
        if (record.repositoryName !== repositoryName) continue;
        if (isRepositorySecretRecord(record)) {
          this.repositorySecretIdByName.delete(
            repositorySecretNameIndex(record.namespace, record.repositoryName, record.name),
          );
        }
        if (this.repositorySecretById.delete(record.id)) {
          deleted++;
        }
      }
      return deleted;
    },
  };

  readonly repositoryPluginPolicies = {
    getByEcosystem: async (ecosystem: string): Promise<RepositoryPluginPolicyRecord | null> => {
      return this.repositoryPluginPolicyByEcosystem.get(ecosystem) ?? null;
    },
    list: async (): Promise<RepositoryPluginPolicyRecord[]> => {
      return [...this.repositoryPluginPolicyByEcosystem.values()].sort((left, right) =>
        left.ecosystem.localeCompare(right.ecosystem),
      );
    },
    save: async (record: RepositoryPluginPolicyRecord): Promise<void> => {
      this.repositoryPluginPolicyByEcosystem.set(record.ecosystem, record);
    },
  };

  readonly repositoryActivities = {
    listByRepository: async (repositoryName: string): Promise<RepositoryActivityRecord[]> => {
      return [...this.repositoryActivityById.values()]
        .filter((activity) => activity.repositoryName === repositoryName)
        .sort(compareRepositoryActivities);
    },
    save: async (record: RepositoryActivityRecord): Promise<void> => {
      this.repositoryActivityById.set(record.id, record);
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
    listByRepository: async (repositoryName: string): Promise<RepositoryArtifactRecord[]> => {
      return [...this.repositoryArtifactById.values()]
        .filter((artifact) => artifact.repositoryName === repositoryName)
        .sort(compareRepositoryArtifacts);
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
      this.repositoryArtifactById.set(record.id, record);
      this.repositoryArtifactIdByIdentity.set(identityIndex, record.id);
    },
    replaceByRepository: async (repositoryName: string, records: RepositoryArtifactRecord[]): Promise<void> => {
      for (const artifact of [...this.repositoryArtifactById.values()]) {
        if (artifact.repositoryName !== repositoryName) continue;
        this.repositoryArtifactById.delete(artifact.id);
        this.repositoryArtifactIdByIdentity.delete(repositoryArtifactIdentityIndex(artifact.repositoryName, artifact.identity));
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

function repositoryArtifactIdentityIndex(repositoryName: string, identity: string): string {
  return `${repositoryName}\0${identity}`;
}

function repositorySecretNameIndex(namespace: string, repositoryName: string, name: string): string {
  return `${namespace}\0${repositoryName}\0${name}`;
}

function isRepositorySecretRecord(record: RepositorySecretRecord | SigningKeyRecord): record is RepositorySecretRecord {
  return "namespace" in record;
}
