import type { Clock, Repository, RepositoryObjectStore } from "@axis-repository/core";
import type { RepositoryRuntimePluginRegistry } from "../plugins/repository-runtime-plugin-registry";
import { scopeObjectStoreToRepository } from "../plugins/scoped-capabilities";

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
  /** When the caller should run maintenance again. */
  nextRunAt: Date;
}

export async function runRepositoryMaintenance(input: {
  repositories: Repository[];
  plugins: RepositoryRuntimePluginRegistry;
  repositoryObjectStore: RepositoryObjectStore;
  clock: Clock;
}): Promise<RepositoryMaintenanceRun> {
  const now = input.clock.now();
  const refreshed: RepositoryMaintenanceRun["refreshed"] = [];
  const failures: RepositoryMaintenanceRun["failures"] = [];
  const dueTimes: number[] = [];

  for (const repository of input.repositories) {
    const maintenance = input.plugins.getPlugin(repository.ecosystem)?.maintenance;
    if (!maintenance) {
      continue;
    }

    try {
      const result = await maintenance.run({
        repository,
        objectStore: scopeObjectStoreToRepository(input.repositoryObjectStore, repository.name),
        now,
      });
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

  return { refreshed, failures, nextRunAt: nextRunAt(dueTimes, now) };
}

function nextRunAt(dueTimes: number[], now: Date): Date {
  const soonest = dueTimes.length > 0 ? Math.min(...dueTimes) : Number.POSITIVE_INFINITY;
  const delay = Math.min(
    Math.max(soonest - now.getTime(), MAINTENANCE_MIN_INTERVAL_MS),
    MAINTENANCE_MAX_INTERVAL_MS,
  );
  return new Date(now.getTime() + delay);
}
