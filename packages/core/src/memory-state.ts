import type { PublishSession, PublishTokenRecord, Repository } from "./domain";
import type { StateStore } from "./ports";

export class MemoryStateStore implements StateStore {
  private readonly repositoryByName = new Map<string, Repository>();
  private readonly publishSessionById = new Map<string, PublishSession>();
  private readonly publishTokenById = new Map<string, PublishTokenRecord>();
  private readonly publishTokenIdByName = new Map<string, string>();

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
      this.publishTokenById.set(token.id, token);
      this.publishTokenIdByName.set(token.name, token.id);
    },
  };
}
