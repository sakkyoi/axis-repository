import { describe, expect, it } from "vitest";
import { MemoryRepositoryObjectStore } from "../storage/repository-object-store";
import { STAGING_SWEEP_GRACE_MS, discardExpiredStagedUploads } from "./staging-sweep";

const SESSION_TTL_MS = 15 * 60 * 1000;
const NOW = new Date("2026-07-30T12:00:00.000Z");

/** A store whose objects were written at the ages given, keyed by name. */
async function storeWithAges(ages: Record<string, number>): Promise<MemoryRepositoryObjectStore> {
  const store = new MemoryRepositoryObjectStore();
  for (const [key, ageMs] of Object.entries(ages)) {
    store.now = () => new Date(NOW.getTime() - ageMs);
    await store.putText(key, "bytes", "application/octet-stream");
  }
  return store;
}

function sweep(store: MemoryRepositoryObjectStore) {
  return discardExpiredStagedUploads({ objectStore: store, now: NOW, sessionTtlMs: SESSION_TTL_MS });
}

describe("sweeping staged uploads", () => {
  it("keeps an upload a session could still finish", async () => {
    // Deleting one mid-publish fails a publish that was going to succeed, so
    // anything inside a session's own lifetime is left alone.
    const store = await storeWithAges({
      "_staging/uploads/deb/pub_1/upl_1/app.deb": SESSION_TTL_MS / 2,
    });

    await expect(sweep(store)).resolves.toEqual([]);
    expect(store.objects).toHaveLength(1);
  });

  it("keeps one whose session has only just expired", async () => {
    // An expiring session and a slow upload look the same from here, and the
    // cost of waiting is bytes rather than a failed publish.
    const store = await storeWithAges({
      "_staging/uploads/deb/pub_1/upl_1/app.deb": SESSION_TTL_MS + 1000,
    });

    await expect(sweep(store)).resolves.toEqual([]);
  });

  it("discards one no session could still be holding", async () => {
    const store = await storeWithAges({
      "_staging/uploads/deb/pub_1/upl_1/app.deb": SESSION_TTL_MS + STAGING_SWEEP_GRACE_MS + 1000,
    });

    await expect(sweep(store)).resolves.toEqual(["_staging/uploads/deb/pub_1/upl_1/app.deb"]);
    expect(store.objects).toHaveLength(0);
  });

  it("discards what a protocol upload left behind", async () => {
    // twine uploads are staged elsewhere and removed when the request ends —
    // unless it does not end, which nothing else was watching for.
    const store = await storeWithAges({
      "_staging/protocol/py/abcdef": SESSION_TTL_MS + STAGING_SWEEP_GRACE_MS + 1000,
    });

    await expect(sweep(store)).resolves.toEqual(["_staging/protocol/py/abcdef"]);
  });

  it("touches nothing a repository publishes", async () => {
    // The sweep runs over a whole bucket on a timer, so the one thing it must
    // never do is mistake a published artifact for a leftover.
    const store = await storeWithAges({
      "repositories/deb/pool/main/app/app.deb": 365 * 24 * 60 * 60 * 1000,
      "repositories/deb/dists/noble/Release": 365 * 24 * 60 * 60 * 1000,
    });

    await expect(sweep(store)).resolves.toEqual([]);
    expect(store.objects).toHaveLength(2);
  });

  it("leaves alone what it cannot date", async () => {
    // Without a timestamp there is no telling a leftover from an upload in
    // flight, and guessing would delete someone's publish.
    const store = new MemoryRepositoryObjectStore();
    await store.putText("_staging/uploads/deb/pub_1/upl_1/app.deb", "bytes", "application/octet-stream");
    store.objects[0]!.uploadedAt = undefined as unknown as Date;

    await expect(sweep(store)).resolves.toEqual([]);
    expect(store.objects).toHaveLength(1);
  });

  it("carries on when one object cannot be deleted", async () => {
    // A sweep that stopped at the first failure would never reach the rest,
    // and would keep not reaching them.
    const store = await storeWithAges({
      "_staging/uploads/deb/pub_1/upl_1/first.deb": SESSION_TTL_MS + STAGING_SWEEP_GRACE_MS + 1000,
      "_staging/uploads/deb/pub_1/upl_2/second.deb": SESSION_TTL_MS + STAGING_SWEEP_GRACE_MS + 1000,
    });
    const deleteObject = store.deleteObject.bind(store);
    store.deleteObject = async (key: string) => {
      if (key.endsWith("first.deb")) {
        throw new Error("storage said no");
      }
      return deleteObject(key);
    };

    await expect(sweep(store)).resolves.toEqual(["_staging/uploads/deb/pub_1/upl_2/second.deb"]);
  });
});
