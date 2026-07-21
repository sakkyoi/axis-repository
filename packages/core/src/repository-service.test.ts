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

  it("gets repositories by name", async () => {
    const state = new MemoryStateStore();
    const service = new RepositoryService({ state, clock, randomId });
    const repository = await service.create({
      name: "debian-internal",
      ecosystem: "apt",
      visibility: "private",
      config: { apt: { codename: "noble" } },
    });

    await expect(service.getByName("debian-internal")).resolves.toEqual(repository);
  });

  it("updates repository visibility and config without changing immutable fields", async () => {
    const state = new MemoryStateStore();
    const mutableClock: Clock = {
      now: () => new Date("2026-07-13T00:00:00.000Z"),
    };
    const service = new RepositoryService({ state, clock: mutableClock, randomId });
    const repository = await service.create({
      name: "debian-internal",
      ecosystem: "apt",
      visibility: "private",
      config: { apt: { codename: "noble", components: ["main"] } },
    });
    mutableClock.now = () => new Date("2026-07-14T00:00:00.000Z");

    const updated = await service.update("debian-internal", {
      visibility: "public",
      config: { apt: { codename: "jammy", components: ["main", "contrib"] } },
    });

    expect(updated).toEqual({
      ...repository,
      visibility: "public",
      config: { apt: { codename: "jammy", components: ["main", "contrib"] } },
      updatedAt: "2026-07-14T00:00:00.000Z",
    });
    await expect(service.getByName("debian-internal")).resolves.toEqual(updated);
  });

  it("rejects empty repository update payloads", async () => {
    const state = new MemoryStateStore();
    const service = new RepositoryService({ state, clock, randomId });
    await service.create({
      name: "debian-internal",
      ecosystem: "apt",
      visibility: "private",
      config: {},
    });

    await expect(service.update("debian-internal", {})).rejects.toThrow(
      "Repository update must include visibility or config",
    );
  });
});
