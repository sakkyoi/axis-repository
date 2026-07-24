import type {
  PublishSession,
  PublishTokenRecord,
  Repository,
  RepositorySecretRecord,
  RepositoryPluginPolicyRecord,
  SigningKeyRecord,
} from "./domain";
import type { StateStore } from "./ports";

function clonePublishSession(session: PublishSession): PublishSession {
  return JSON.parse(JSON.stringify(session)) as PublishSession;
}

export class MemoryStateStore implements StateStore {
  private readonly repositoryByName = new Map<string, Repository>();
  private readonly publishSessionById = new Map<string, PublishSession>();
  private readonly publishTokenById = new Map<string, PublishTokenRecord>();
  private readonly publishTokenIdByName = new Map<string, string>();
  private readonly repositorySecretById = new Map<string, RepositorySecretRecord | SigningKeyRecord>();
  private readonly repositorySecretIdByName = new Map<string, string>();
  private readonly repositoryPluginPolicyByEcosystem = new Map<string, RepositoryPluginPolicyRecord>();

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
}

function comparePublishSessions(left: PublishSession, right: PublishSession): number {
  const createdAtOrder = right.createdAt.localeCompare(left.createdAt);
  return createdAtOrder === 0 ? left.id.localeCompare(right.id) : createdAtOrder;
}

function repositorySecretNameIndex(namespace: string, repositoryName: string, name: string): string {
  return `${namespace}\0${repositoryName}\0${name}`;
}

function isRepositorySecretRecord(record: RepositorySecretRecord | SigningKeyRecord): record is RepositorySecretRecord {
  return "namespace" in record;
}
