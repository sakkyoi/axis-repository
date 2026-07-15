import { describe, expect, it } from "vitest";
import { MemoryStateStore, type PublishSession, type PublishTokenRecord } from "./index";

const token = (overrides: Partial<PublishTokenRecord>): PublishTokenRecord => ({
  id: "tok_1",
  name: "publish-token",
  tokenHash: "hash_1",
  permissions: ["publish"],
  repositories: ["debian-internal"],
  ecosystemScopes: {},
  createdAt: "2026-07-12T00:00:00.000Z",
  ...overrides,
});

const session = (overrides: Partial<PublishSession>): PublishSession => ({
  id: "pub_1",
  repositoryName: "debian-internal",
  ecosystem: "apt",
  status: "ready",
  requestedBy: {
    tokenId: "tok_1",
    name: "publish-token",
    permissions: ["publish"],
    repositories: ["debian-internal"],
    ecosystemScopes: {},
  },
  artifacts: [],
  uploads: [],
  verifiedUploads: [],
  createdAt: "2026-07-12T00:00:00.000Z",
  expiresAt: "2026-07-12T00:15:00.000Z",
  ...overrides,
});

describe("MemoryStateStore", () => {
  it("keeps publish token name indexes consistent when tokens are renamed", async () => {
    const state = new MemoryStateStore();

    await state.publishTokens.save(token({ id: "tok_1", name: "old-name" }));
    await state.publishTokens.save(token({ id: "tok_1", name: "new-name" }));

    expect(await state.publishTokens.getByName("old-name")).toBeNull();
    expect(await state.publishTokens.getByName("new-name")).toEqual(
      token({ id: "tok_1", name: "new-name" }),
    );
    expect(await state.publishTokens.list()).toEqual([token({ id: "tok_1", name: "new-name" })]);
  });

  it("replaces the previous token when a name is reused by another id", async () => {
    const state = new MemoryStateStore();

    await state.publishTokens.save(token({ id: "tok_1", name: "shared-name" }));
    await state.publishTokens.save(token({ id: "tok_2", name: "shared-name" }));

    expect(await state.publishTokens.getById("tok_1")).toBeNull();
    expect(await state.publishTokens.getByName("shared-name")).toEqual(
      token({ id: "tok_2", name: "shared-name" }),
    );
    expect(await state.publishTokens.list()).toEqual([token({ id: "tok_2", name: "shared-name" })]);
  });

  it("compare-and-sets publish session status only when the expected status matches", async () => {
    const state = new MemoryStateStore();
    await state.publishSessions.save(session({ status: "ready" }));

    await expect(
      state.publishSessions.compareAndSetStatus(
        "pub_1",
        "ready",
        session({ status: "finalizing" }),
      ),
    ).resolves.toBe(true);
    await expect(state.publishSessions.get("pub_1")).resolves.toMatchObject({
      status: "finalizing",
    });

    await expect(
      state.publishSessions.compareAndSetStatus(
        "pub_1",
        "ready",
        session({ status: "finalized" }),
      ),
    ).resolves.toBe(false);
    await expect(state.publishSessions.get("pub_1")).resolves.toMatchObject({
      status: "finalizing",
    });
  });
});
