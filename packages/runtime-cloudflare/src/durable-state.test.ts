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

const publishSession = (overrides: Partial<PublishSession>): PublishSession => ({
  id: "pub_1",
  repositoryName: "debian-internal",
  ecosystem: "apt",
  status: "ready",
  requestedBy: {
    tokenId: "ptok_1",
    name: "ci",
    permissions: ["publish"],
    repositories: ["debian-internal"],
    ecosystemScopes: {},
  },
  artifacts: [],
  uploads: [],
  verifiedUploads: [],
  createdAt: "2026-07-14T00:00:00.000Z",
  expiresAt: "2026-07-14T00:15:00.000Z",
  ...overrides,
});

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
    const session = publishSession({ status: "pending_uploads" });

    await state.publishSessions.save(session);

    await expect(state.publishSessions.get("pub_1")).resolves.toEqual(session);
  });

  it("compare-and-sets publish session status only when the expected status matches", async () => {
    const state = new DurableStateStore(new FakeDurableStorage());
    await state.publishSessions.save(publishSession({ status: "ready" }));

    await expect(
      state.publishSessions.compareAndSetStatus(
        "pub_1",
        "ready",
        publishSession({ status: "finalizing" }),
      ),
    ).resolves.toBe(true);
    await expect(state.publishSessions.get("pub_1")).resolves.toMatchObject({
      status: "finalizing",
    });

    await expect(
      state.publishSessions.compareAndSetStatus(
        "pub_1",
        "ready",
        publishSession({ status: "finalized" }),
      ),
    ).resolves.toBe(false);
    await expect(state.publishSessions.get("pub_1")).resolves.toMatchObject({
      status: "finalizing",
    });
  });

  it("does not compare-and-set a publish session with a mismatched replacement id", async () => {
    const state = new DurableStateStore(new FakeDurableStorage());
    const original = publishSession({ status: "ready" });
    await state.publishSessions.save(original);

    await expect(
      state.publishSessions.compareAndSetStatus(
        "pub_1",
        "ready",
        publishSession({ id: "pub_2", status: "finalizing" }),
      ),
    ).resolves.toBe(false);

    await expect(state.publishSessions.get("pub_1")).resolves.toEqual(original);
    await expect(state.publishSessions.get("pub_2")).resolves.toBeNull();
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
