import { describe, expect, it } from "vitest";
import type {
  PublishSession,
  PublishTokenRecord,
  Repository,
} from "@axis-repository/core";
import { DurableStateStore, type DurableStorage } from "./durable-state";

class FakeDurableStorage implements DurableStorage {
  readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<boolean> {
    return this.values.delete(key);
  }

  async list<T>(options?: { prefix?: string }): Promise<Map<string, T>> {
    const result = new Map<string, T>();
    for (const [key, value] of this.values) {
      if (!options?.prefix || key.startsWith(options.prefix)) {
        result.set(key, value as T);
      }
    }
    return result;
  }
}

const repository: Repository = {
  id: "repo_1",
  name: "debian-internal",
  ecosystem: "apt",
  visibility: "private",
  config: { codenames: ["noble"] },
  createdAt: "2026-07-14T00:00:00.000Z",
  updatedAt: "2026-07-14T00:00:00.000Z",
};

describe("DurableStateStore", () => {
  it("persists repositories by name and lists them sorted", async () => {
    const storage = new FakeDurableStorage();
    const state = new DurableStateStore(storage);

    await state.repositories.save({
      ...repository,
      name: "python-internal",
      ecosystem: "pypi",
    });
    await state.repositories.save(repository);

    await expect(state.repositories.getByName("debian-internal")).resolves.toEqual(
      repository,
    );
    await expect(state.repositories.list()).resolves.toMatchObject([
      { name: "debian-internal" },
      { name: "python-internal" },
    ]);
  });

  it("persists publish sessions by id", async () => {
    const state = new DurableStateStore(new FakeDurableStorage());
    const session: PublishSession = {
      id: "pub_1",
      repositoryName: "debian-internal",
      ecosystem: "apt",
      status: "created",
      requestedBy: {
        tokenId: "ptok_1",
        name: "ci",
        permissions: ["publish"],
        repositories: ["debian-internal"],
        ecosystemScopes: {},
      },
      uploads: [],
      createdAt: "2026-07-14T00:00:00.000Z",
      expiresAt: "2026-07-14T00:15:00.000Z",
    };

    await state.publishSessions.save(session);

    await expect(state.publishSessions.get("pub_1")).resolves.toEqual(session);
  });

  it("keeps publish token name and id indexes consistent", async () => {
    const state = new DurableStateStore(new FakeDurableStorage());
    const original: PublishTokenRecord = {
      id: "ptok_1",
      name: "old-name",
      tokenHash: "hash",
      permissions: ["publish"],
      repositories: ["debian-internal"],
      ecosystemScopes: {},
      createdAt: "2026-07-14T00:00:00.000Z",
    };

    await state.publishTokens.save(original);
    await state.publishTokens.save({ ...original, name: "new-name" });

    await expect(state.publishTokens.getByName("old-name")).resolves.toBeNull();
    await expect(state.publishTokens.getByName("new-name")).resolves.toMatchObject({
      id: "ptok_1",
    });
  });
});
