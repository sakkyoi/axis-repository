import type { RepositoryObjectStore } from "@axis-repository/core";
import { listAllObjects } from "../plugins/repository-object-helpers";

/**
 * Throws away staged uploads nobody is going to finish.
 *
 * An upload is stored under `_staging/` and moved into the repository when the
 * publish it belongs to completes. Publishing removes it; nothing else does,
 * and there are more ways for a publish not to complete than to complete — a
 * session abandoned, a session expired, a finalize that threw, a repository
 * deleted out from under it, a Worker evicted mid-request. Each was a leak of
 * whole artifacts, and patching them one at a time would leave the ones nobody
 * has thought of yet.
 *
 * Age settles all of them at once. A publish session lives for a bounded time,
 * so a staged object older than that belongs to no session that can still act
 * on it, whatever became of the one it came from.
 */

/**
 * How long past a session's own lifetime a staged upload is left alone.
 *
 * Deleting one still being written would fail a publish that was going to
 * succeed, and the cost of waiting is some bytes kept a while longer. Erring
 * this way is the only sensible direction.
 */
export const STAGING_SWEEP_GRACE_MS = 60 * 60 * 1000;

export const STAGING_PREFIX = "_staging/";

export async function discardExpiredStagedUploads(input: {
  objectStore: RepositoryObjectStore;
  now: Date;
  sessionTtlMs: number;
}): Promise<string[]> {
  const cutoff = input.now.getTime() - input.sessionTtlMs - STAGING_SWEEP_GRACE_MS;
  const staged = await listAllObjects(input.objectStore, STAGING_PREFIX);
  const expired = staged.filter((object) =>
    // A store that does not date its objects cannot say which are stale, and
    // guessing would delete uploads in progress.
    object.uploadedAt !== undefined && object.uploadedAt.getTime() < cutoff);

  const discarded = await Promise.all(expired.map(async (object) => {
    try {
      return await input.objectStore.deleteObject(object.key) ? object.key : undefined;
    } catch {
      // Another sweep will find it; failing here would abandon the rest.
      return undefined;
    }
  }));

  return discarded.filter((key): key is string => key !== undefined);
}
