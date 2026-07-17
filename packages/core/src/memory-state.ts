import type { PublishSession, PublishTokenRecord, Repository, SigningKeyRecord } from "./domain";
import type { StateStore } from "./ports";

function clonePublishSession(session: PublishSession): PublishSession {
  return JSON.parse(JSON.stringify(session)) as PublishSession;
}

export class MemoryStateStore implements StateStore {
  private readonly repositoryByName = new Map<string, Repository>();
  private readonly publishSessionById = new Map<string, PublishSession>();
  private readonly publishTokenById = new Map<string, PublishTokenRecord>();
  private readonly publishTokenIdByName = new Map<string, string>();
  private readonly signingKeyById = new Map<string, SigningKeyRecord>();
  private readonly signingKeyIdByName = new Map<string, string>();

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

  readonly signingKeys = {
    getById: async (id: string): Promise<SigningKeyRecord | null> => {
      return this.signingKeyById.get(id) ?? null;
    },
    getByName: async (name: string): Promise<SigningKeyRecord | null> => {
      const id = this.signingKeyIdByName.get(name);
      return id ? this.signingKeyById.get(id) ?? null : null;
    },
    list: async (): Promise<SigningKeyRecord[]> => {
      return [...this.signingKeyById.values()].sort((left, right) =>
        left.name.localeCompare(right.name),
      );
    },
    save: async (record: SigningKeyRecord): Promise<void> => {
      const existing = this.signingKeyById.get(record.id);
      if (existing && existing.name !== record.name) {
        this.signingKeyIdByName.delete(existing.name);
      }

      const existingIdForName = this.signingKeyIdByName.get(record.name);
      if (existingIdForName && existingIdForName !== record.id) {
        this.signingKeyById.delete(existingIdForName);
      }

      this.signingKeyById.set(record.id, record);
      this.signingKeyIdByName.set(record.name, record.id);
    },
  };
}
