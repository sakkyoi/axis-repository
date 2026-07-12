import type { PublishSession, Repository } from "./domain";
import type { StateStore } from "./ports";

export class MemoryStateStore implements StateStore {
  private readonly repositoryByName = new Map<string, Repository>();
  private readonly publishSessionById = new Map<string, PublishSession>();

  readonly repositories = {
    getByName: async (name: string): Promise<Repository | null> => {
      return this.repositoryByName.get(name) ?? null;
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
}
