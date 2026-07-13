import { describe, expect, it } from "vitest";
import { MemoryStateStore, type PublishTokenRecord } from "./index";

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
});
