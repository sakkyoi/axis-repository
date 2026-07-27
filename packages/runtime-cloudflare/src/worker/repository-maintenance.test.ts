import { describe, expect, it } from "vitest";
import type { Repository } from "@axis-repository/core";
import type { ArtifactRepositoryPlugin, RepositoryMaintenanceResult } from "../plugins/repository-plugin-contract";
import { MemoryRepositoryObjectStore } from "../storage/repository-object-store";
import {
  MAINTENANCE_MAX_INTERVAL_MS,
  MAINTENANCE_MIN_INTERVAL_MS,
  runRepositoryMaintenance,
} from "./repository-maintenance";

const NOW = new Date("2026-07-18T00:00:00.000Z");
const clock = { now: () => NOW };

function repository(name: string, ecosystem = "apt"): Repository {
  return {
    id: `repo_${name}`,
    name,
    ecosystem,
    visibility: "private",
    config: {},
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
}

function registry(plugins: Record<string, Partial<ArtifactRepositoryPlugin>>) {
  return {
    getPlugin: (ecosystem: string) => plugins[ecosystem] as ArtifactRepositoryPlugin | undefined,
  } as never;
}

function maintenancePlugin(
  run: () => Promise<RepositoryMaintenanceResult>,
): Partial<ArtifactRepositoryPlugin> {
  return { maintenance: { run } };
}

describe("runRepositoryMaintenance", () => {
  it("comes back at the soonest thing that is due", async () => {
    const run = await runRepositoryMaintenance({
      repositories: [repository("early"), repository("late")],
      plugins: registry({
        apt: maintenancePlugin(async () => ({
          refreshed: [],
          nextDueAt: new Date(NOW.getTime() + 60 * 60 * 1000),
        })),
      }),
      repositoryObjectStore: new MemoryRepositoryObjectStore(),
      clock,
    });

    expect(run.nextRunAt.getTime()).toBe(NOW.getTime() + 60 * 60 * 1000);
  });

  it("still comes back when nothing is due, so a config change is picked up", async () => {
    const run = await runRepositoryMaintenance({
      repositories: [repository("idle")],
      plugins: registry({ apt: maintenancePlugin(async () => ({ refreshed: [] })) }),
      repositoryObjectStore: new MemoryRepositoryObjectStore(),
      clock,
    });

    expect(run.nextRunAt.getTime()).toBe(NOW.getTime() + MAINTENANCE_MAX_INTERVAL_MS);
  });

  it("refuses to spin on a repository that reports itself perpetually overdue", async () => {
    const run = await runRepositoryMaintenance({
      repositories: [repository("overdue")],
      plugins: registry({
        apt: maintenancePlugin(async () => ({
          refreshed: ["noble"],
          nextDueAt: new Date(NOW.getTime() - 10_000),
        })),
      }),
      repositoryObjectStore: new MemoryRepositoryObjectStore(),
      clock,
    });

    expect(run.nextRunAt.getTime()).toBe(NOW.getTime() + MAINTENANCE_MIN_INTERVAL_MS);
  });

  it("keeps going past a repository that fails, and still schedules the next run", async () => {
    // A revoked signing key stops one repository being re-signed. Letting that
    // abort the pass would leave every other repository to expire as well.
    const run = await runRepositoryMaintenance({
      repositories: [repository("broken"), repository("healthy", "pypi")],
      plugins: registry({
        apt: maintenancePlugin(() => Promise.reject(new Error("signing key revoked"))),
        pypi: maintenancePlugin(async () => ({
          refreshed: ["noble"],
          nextDueAt: new Date(NOW.getTime() + 120_000),
        })),
      }),
      repositoryObjectStore: new MemoryRepositoryObjectStore(),
      clock,
    });

    expect(run.failures).toEqual([{ repositoryName: "broken", message: "signing key revoked" }]);
    expect(run.refreshed).toEqual([{ repositoryName: "healthy", details: ["noble"] }]);
    expect(run.nextRunAt.getTime()).toBe(NOW.getTime() + 120_000);
  });

  it("skips ecosystems whose plugin has nothing to maintain", async () => {
    const run = await runRepositoryMaintenance({
      repositories: [repository("pypi-only", "pypi")],
      plugins: registry({ pypi: {} }),
      repositoryObjectStore: new MemoryRepositoryObjectStore(),
      clock,
    });

    expect(run.refreshed).toEqual([]);
    expect(run.failures).toEqual([]);
    expect(run.nextRunAt.getTime()).toBe(NOW.getTime() + MAINTENANCE_MAX_INTERVAL_MS);
  });
});
