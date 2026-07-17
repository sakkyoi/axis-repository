import type {
  PublishSession,
  PublishTokenRecord,
  Repository,
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
const signingKeyKey = (id: string) => `signing-key:${id}`;
const signingKeyNameKey = (name: string) => `signing-key-name:${name}`;

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
  };

  readonly publishSessions = {
    get: async (id: string): Promise<PublishSession | null> => {
      return (await this.storage.get<PublishSession>(sessionKey(id))) ?? null;
    },
    save: async (session: PublishSession): Promise<void> => {
      await this.storage.put(sessionKey(session.id), session);
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
    compareAndSetStatus: async (
      id: string,
      expectedStatus: PublishSession["status"],
      session: PublishSession,
    ): Promise<boolean> => {
      if (session.id !== id) {
        return false;
      }
      return this.withSessionMutation(async () => {
        const current = (await this.storage.get<PublishSession>(sessionKey(id))) ?? null;
        if (!current || current.status !== expectedStatus) {
          return false;
        }
        await this.storage.put(sessionKey(id), session);
        return true;
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
  };

  readonly signingKeys = {
    getById: async (id: string): Promise<SigningKeyRecord | null> => {
      return (await this.storage.get<SigningKeyRecord>(signingKeyKey(id))) ?? null;
    },
    getByName: async (name: string): Promise<SigningKeyRecord | null> => {
      const id = await this.storage.get<string>(signingKeyNameKey(name));
      return id
        ? ((await this.storage.get<SigningKeyRecord>(signingKeyKey(id))) ?? null)
        : null;
    },
    list: async (): Promise<SigningKeyRecord[]> => {
      const values = await this.storage.list<SigningKeyRecord>({
        prefix: "signing-key:",
      });
      return [...values.values()].sort((left, right) =>
        left.name.localeCompare(right.name),
      );
    },
    save: async (record: SigningKeyRecord): Promise<void> => {
      const existing = await this.storage.get<SigningKeyRecord>(
        signingKeyKey(record.id),
      );
      if (existing && existing.name !== record.name) {
        await this.storage.delete(signingKeyNameKey(existing.name));
      }

      const existingIdForName = await this.storage.get<string>(
        signingKeyNameKey(record.name),
      );
      if (existingIdForName && existingIdForName !== record.id) {
        await this.storage.delete(signingKeyKey(existingIdForName));
      }

      await this.storage.put(signingKeyKey(record.id), record);
      await this.storage.put(signingKeyNameKey(record.name), record.id);
    },
  };
}
