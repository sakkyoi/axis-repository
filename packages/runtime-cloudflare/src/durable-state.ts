import type {
  PublishSession,
  PublishTokenRecord,
  Repository,
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

export class DurableStateStore implements StateStore {
  constructor(private readonly storage: DurableStorage) {}

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
  };

  readonly publishSessions = {
    get: async (id: string): Promise<PublishSession | null> => {
      return (await this.storage.get<PublishSession>(sessionKey(id))) ?? null;
    },
    save: async (session: PublishSession): Promise<void> => {
      await this.storage.put(sessionKey(session.id), session);
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
  };
}
