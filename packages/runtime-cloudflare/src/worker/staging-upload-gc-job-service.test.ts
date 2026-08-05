import { describe, expect, it } from "vitest";
import { MemoryStateStore, type Clock } from "@axis-repository/core";
import { MemoryRepositoryObjectStore } from "../storage/repository-object-store";
import { STAGING_SWEEP_GRACE_MS } from "./staging-sweep";
import { StagingUploadGcJobService } from "./staging-upload-gc-job-service";

const SESSION_TTL_MS = 15 * 60 * 1000;
const NOW = new Date("2026-08-05T00:00:00.000Z");

const clock: Clock = { now: () => NOW };

async function objectStoreWith(input: Record<string, number>): Promise<MemoryRepositoryObjectStore> {
  const store = new MemoryRepositoryObjectStore();
  for (const [key, ageMs] of Object.entries(input)) {
    store.now = () => new Date(NOW.getTime() - ageMs);
    await store.putBytes(key, new Uint8Array([1, 2, 3]), "application/octet-stream");
  }
  return store;
}

describe("StagingUploadGcJobService", () => {
  it("records a system background job when staging uploads are garbage-collected", async () => {
    const state = new MemoryStateStore();
    const objectStore = await objectStoreWith({
      "_staging/uploads/debian-internal/pub_1/upl_1/app.deb": SESSION_TTL_MS + STAGING_SWEEP_GRACE_MS + 1000,
      "_staging/uploads/debian-internal/pub_2/upl_1/fresh.deb": SESSION_TTL_MS / 2,
      "repositories/debian-internal/pool/main/app.deb": SESSION_TTL_MS + STAGING_SWEEP_GRACE_MS + 1000,
    });
    const service = new StagingUploadGcJobService({ state, objectStore, clock, sessionTtlMs: SESSION_TTL_MS });

    await expect(service.run()).resolves.toMatchObject({
      discardedObjectKeys: ["_staging/uploads/debian-internal/pub_1/upl_1/app.deb"],
    });

    await expect(state.backgroundJobs.get("storage.staging-upload-gc")).resolves.toMatchObject({
      id: "storage.staging-upload-gc",
      type: "storage.staging-upload-gc",
      status: "succeeded",
      subject: { type: "system", id: "staging-uploads" },
      result: {
        discardedObjectCount: 1,
      },
    });
    await expect(objectStore.headObject("_staging/uploads/debian-internal/pub_1/upl_1/app.deb")).resolves.toBeNull();
    await expect(objectStore.headObject("_staging/uploads/debian-internal/pub_2/upl_1/fresh.deb")).resolves.not.toBeNull();
    await expect(objectStore.headObject("repositories/debian-internal/pool/main/app.deb")).resolves.not.toBeNull();
  });

  it("records failures as background job failures", async () => {
    const state = new MemoryStateStore();
    const objectStore = new MemoryRepositoryObjectStore();
    objectStore.listObjects = async () => {
      throw new Error("Network connection lost.");
    };
    const service = new StagingUploadGcJobService({ state, objectStore, clock, sessionTtlMs: SESSION_TTL_MS });

    await expect(service.run()).rejects.toThrow("Network connection lost.");

    await expect(state.backgroundJobs.get("storage.staging-upload-gc")).resolves.toMatchObject({
      status: "failed",
      failure: {
        message: "Network connection lost.",
        retryable: true,
      },
    });
  });
});
