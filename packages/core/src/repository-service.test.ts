import { describe, expect, it } from "vitest";
import {
  MemoryStateStore,
  RepositoryService,
  ValidationError,
  type Clock,
  type RandomId,
} from "./index";

const clock: Clock = {
  now: () => new Date("2026-07-13T00:00:00.000Z"),
};

const randomId: RandomId = {
  create: (prefix: string) => `${prefix}_fixed`,
};

describe("RepositoryService", () => {
  it("creates and lists repositories", async () => {
    const state = new MemoryStateStore();
    const service = new RepositoryService({ state, clock, randomId });

    const repository = await service.create({
      name: "debian-internal",
      ecosystem: "apt",
      visibility: "private",
      config: { codenames: ["noble"] },
    });

    expect(repository).toEqual({
      id: "repo_fixed",
      name: "debian-internal",
      ecosystem: "apt",
      visibility: "private",
      config: { codenames: ["noble"] },
      createdAt: "2026-07-13T00:00:00.000Z",
      updatedAt: "2026-07-13T00:00:00.000Z",
    });
    await expect(service.list()).resolves.toEqual([repository]);
  });

  it("rejects duplicate repository names", async () => {
    const state = new MemoryStateStore();
    const service = new RepositoryService({ state, clock, randomId });

    await service.create({
      name: "python-internal",
      ecosystem: "pypi",
      visibility: "private",
      config: {},
    });

    await expect(
      service.create({
        name: "python-internal",
        ecosystem: "pypi",
        visibility: "private",
        config: {},
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
