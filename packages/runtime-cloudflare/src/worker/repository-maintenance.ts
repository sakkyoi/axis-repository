import type { Clock, Repository, RepositoryObjectStore } from "@axis-repository/core";
import type { RepositoryRuntimePluginRegistry } from "../plugins/repository-runtime-plugin-registry";
import { scopeObjectStoreToRepository } from "../plugins/scoped-capabilities";
import type { RepositoryWriteLock } from "./repository-write-lock";
import { discardExpiredStagedUploads } from "./staging-sweep";

/**
 * Runs whatever every repository needs on a timer, and says when to come back.
 *
 * Published apt metadata carries an expiry, and apt refuses a repository whose
 * `Release` has passed it. Nothing else would move that date on a repository
 * that is simply not being published to, so it would take itself offline after
 * however many days its configuration allows.
 */

/** Never sleep longer than this, so a configuration change is picked up. */
export const MAINTENANCE_MAX_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Nor shorter, so a repository that is always due cannot spin. */
export const MAINTENANCE_MIN_INTERVAL_MS = 60 * 1000;

export interface RepositoryMaintenanceRun {
  refreshed: Array<{ repositoryName: string; details: string[] }>;
  failures: Array<{ repositoryName: string; message: string }>;
  /** Staged uploads discarded because no session could still finish them. */
  staged: string[];
  /** When the caller should run maintenance again. */
  nextRunAt: Date;
}

export async function runRepositoryMaintenance(input: {
  repositories: Repository[];
  plugins: RepositoryRuntimePluginRegistry;
  repositoryObjectStore: RepositoryObjectStore;
  writeLock: RepositoryWriteLock;
  clock: Clock;
  /** How long a publish session lives, which bounds how long its uploads matter. */
  sessionTtlMs: number;
}): Promise<RepositoryMaintenanceRun> {
  const now = input.clock.now();
  const refreshed: RepositoryMaintenanceRun["refreshed"] = [];
  const failures: RepositoryMaintenanceRun["failures"] = [];
  const staged: string[] = [];
  const dueTimes: number[] = [];

  for (const repository of input.repositories) {
    const maintenance = input.plugins.getPlugin(repository.ecosystem)?.maintenance;
    if (!maintenance) {
      continue;
    }

    try {
      // Renewing rewrites the same indexes a publish does, so it queues behind
      // one rather than overwriting whatever it has just written.
      const result = await input.writeLock.run(repository.name, () => maintenance.run({
        repository,
        objectStore: scopeObjectStoreToRepository(input.repositoryObjectStore, repository.name),
        now,
      }));
      if (result.refreshed.length > 0) {
        refreshed.push({ repositoryName: repository.name, details: result.refreshed });
      }
      if (result.nextDueAt) {
        dueTimes.push(result.nextDueAt.getTime());
      }
    } catch (error) {
      // One repository with a revoked signing key must not stop the rest, and
      // must not stop the timer either, or a fixable problem becomes permanent.
      failures.push({
        repositoryName: repository.name,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Outside the loop above, and not behind a plugin: a staged upload belongs
  // to the runtime rather than to any format, and half the repositories here
  // have no maintenance of their own to hang it on.
  try {
    const discarded = await discardExpiredStagedUploads({
      objectStore: input.repositoryObjectStore,
      now,
      sessionTtlMs: input.sessionTtlMs,
    });
    if (discarded.length > 0) {
      staged.push(...discarded);
    }
  } catch (error) {
    failures.push({
      repositoryName: "_staging",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return { refreshed, failures, staged, nextRunAt: nextRunAt(dueTimes, now) };
}

function nextRunAt(dueTimes: number[], now: Date): Date {
  const soonest = dueTimes.length > 0 ? Math.min(...dueTimes) : Number.POSITIVE_INFINITY;
  const delay = Math.min(
    Math.max(soonest - now.getTime(), MAINTENANCE_MIN_INTERVAL_MS),
    MAINTENANCE_MAX_INTERVAL_MS,
  );
  return new Date(now.getTime() + delay);
}
