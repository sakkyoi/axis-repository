import { describe, expect, it } from "vitest";
import { describeStateStoreContract } from "./state-store-contract.test-support";
import {
  MemoryStateStore,
  RepositoryActivityService,
  type RepositoryArtifactRecord,
  type RepositoryActivityRecord,
} from "../index";

describe("MemoryStateStore repository activities", () => {
  it("persists repository activities and lists them newest first", async () => {
    const state = new MemoryStateStore();
    const oldActivity: RepositoryActivityRecord = {
      id: "activity_old",
      repositoryName: "debian-internal",
      type: "object.delete",
      actor: "admin",
      summary: "Deleted pool/main/app.deb",
      metadata: { path: "pool/main/app.deb" },
      createdAt: "2026-07-12T00:00:00.000Z",
    };
    const newActivity: RepositoryActivityRecord = {
      ...oldActivity,
      id: "activity_new",
      createdAt: "2026-07-12T00:01:00.000Z",
    };
    await state.repositoryActivities.save(oldActivity);
    await state.repositoryActivities.save({ ...newActivity, repositoryName: "python-internal" });
    await state.repositoryActivities.save(newActivity);

    await expect(state.repositoryActivities.listByRepository("debian-internal")).resolves.toEqual([
      newActivity,
      oldActivity,
    ]);
  });

  it("records object delete activities through the activity service", async () => {
    const state = new MemoryStateStore();
    const service = new RepositoryActivityService({
      state,
      clock: { now: () => new Date("2026-07-12T00:01:00.000Z") },
      randomId: { create: (prefix) => `${prefix}_1` },
    });

    await expect(service.recordObjectDelete({
      repositoryName: "debian-internal",
      path: "pool/main/app.deb",
      objectKey: "repositories/debian-internal/pool/main/app.deb",
      contentType: "application/vnd.debian.binary-package",
      size: 123,
    })).resolves.toEqual({
      id: "activity_1",
      repositoryName: "debian-internal",
      type: "object.delete",
      actor: "admin",
      summary: "Deleted pool/main/app.deb",
      metadata: {
        path: "pool/main/app.deb",
        objectKey: "repositories/debian-internal/pool/main/app.deb",
        contentType: "application/vnd.debian.binary-package",
        size: 123,
      },
      createdAt: "2026-07-12T00:01:00.000Z",
    });
  });

  it("records object update activities with their previous object metadata", async () => {
    const state = new MemoryStateStore();
    const service = new RepositoryActivityService({
      state,
      clock: { now: () => new Date("2026-07-12T00:01:00.000Z") },
      randomId: { create: (prefix) => `${prefix}_1` },
    });

    await expect(service.recordObjectUpdate({
      repositoryName: "debian-internal",
      path: "dists/noble/Release",
      objectKey: "repositories/debian-internal/dists/noble/Release",
      contentType: "text/plain; charset=utf-8",
      previousContentType: "text/plain",
      previousSize: 120,
      previousEtag: "\"old\"",
    })).resolves.toEqual({
      id: "activity_1",
      repositoryName: "debian-internal",
      type: "object.update",
      actor: "admin",
      summary: "Updated dists/noble/Release",
      metadata: {
        path: "dists/noble/Release",
        objectKey: "repositories/debian-internal/dists/noble/Release",
        contentType: "text/plain; charset=utf-8",
        previousContentType: "text/plain",
        previousSize: 120,
        previousEtag: "\"old\"",
      },
      createdAt: "2026-07-12T00:01:00.000Z",
    });
  });

  it("omits absent previous metadata from object update activities", async () => {
    const state = new MemoryStateStore();
    const service = new RepositoryActivityService({
      state,
      clock: { now: () => new Date("2026-07-12T00:01:00.000Z") },
      randomId: { create: (prefix) => `${prefix}_1` },
    });

    const activity = await service.recordObjectUpdate({
      repositoryName: "debian-internal",
      path: "dists/noble/Release",
      objectKey: "repositories/debian-internal/dists/noble/Release",
      contentType: "text/plain",
    });

    expect(Object.keys(activity.metadata).sort()).toEqual(["contentType", "objectKey", "path"]);
  });

  it("assigns monotonic activity timestamps when the clock does not advance", async () => {
    const state = new MemoryStateStore();
    let id = 0;
    const service = new RepositoryActivityService({
      state,
      clock: { now: () => new Date("2026-07-12T00:01:00.000Z") },
      randomId: { create: (prefix) => `${prefix}_${++id}` },
    });

    const first = await service.recordObjectDelete({
      repositoryName: "debian-internal",
      path: "pool/main/app.deb",
      objectKey: "repositories/debian-internal/pool/main/app.deb",
    });
    const second = await service.recordArtifactIndexRebuild({
      repositoryName: "debian-internal",
      artifactCount: 0,
    });

    expect(first.createdAt).toBe("2026-07-12T00:01:00.000Z");
    expect(second.createdAt).toBe("2026-07-12T00:01:00.001Z");
    await expect(state.repositoryActivities.listByRepository("debian-internal")).resolves.toEqual([second, first]);
  });

  it("records artifact index rebuild activities through the activity service", async () => {
    const state = new MemoryStateStore();
    const service = new RepositoryActivityService({
      state,
      clock: { now: () => new Date("2026-07-12T00:01:00.000Z") },
      randomId: { create: (prefix) => `${prefix}_1` },
    });

    await expect(service.recordArtifactIndexRebuild({
      repositoryName: "debian-internal",
      artifactCount: 2,
    })).resolves.toEqual({
      id: "activity_1",
      repositoryName: "debian-internal",
      type: "artifact-index.rebuild",
      actor: "admin",
      summary: "Rebuilt artifact index",
      metadata: {
        artifactCount: 2,
      },
      createdAt: "2026-07-12T00:01:00.000Z",
    });
  });

  it("records artifact delete activities through the activity service", async () => {
    const state = new MemoryStateStore();
    const service = new RepositoryActivityService({
      state,
      clock: { now: () => new Date("2026-07-12T00:01:00.000Z") },
      randomId: { create: (prefix) => `${prefix}_1` },
    });

    await expect(service.recordArtifactDelete({
      repositoryName: "debian-internal",
      artifactId: "artifact_1",
      identity: "apt:main:myapp:1.2.3:amd64",
      summary: "myapp 1.2.3 amd64",
      name: "myapp",
      version: "1.2.3",
      objectKeys: ["repositories/debian-internal/pool/main/myapp.deb"],
      deletedObjectKeys: ["repositories/debian-internal/pool/main/myapp.deb"],
    })).resolves.toEqual({
      id: "activity_1",
      repositoryName: "debian-internal",
      type: "artifact.delete",
      actor: "admin",
      summary: "Deleted artifact myapp 1.2.3 amd64",
      metadata: {
        artifactId: "artifact_1",
        identity: "apt:main:myapp:1.2.3:amd64",
        name: "myapp",
        version: "1.2.3",
        objectKeys: ["repositories/debian-internal/pool/main/myapp.deb"],
        deletedObjectKeys: ["repositories/debian-internal/pool/main/myapp.deb"],
        missingObjectKeys: [],
        skippedObjectKeys: [],
        failedObjectKeys: [],
      },
      createdAt: "2026-07-12T00:01:00.000Z",
    });
  });
});

describe("MemoryStateStore repository artifacts", () => {
  it("upserts repository artifacts and lists them newest first", async () => {
    const state = new MemoryStateStore();
    const oldArtifact: RepositoryArtifactRecord = {
      id: "artifact_old",
      repositoryName: "debian-internal",
      ecosystem: "apt",
      identity: "apt:myapp:1.2.2:amd64",
      name: "myapp",
      version: "1.2.2",
      summary: "myapp 1.2.2 amd64",
      primaryObjectKey: "repositories/debian-internal/pool/main/m/myapp/myapp_1.2.2_amd64.deb",
      objectKeys: ["repositories/debian-internal/pool/main/m/myapp/myapp_1.2.2_amd64.deb"],
      metadata: { architecture: "amd64" },
      publishedAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-12T00:00:00.000Z",
      publishSessionId: "pub_old",
    };
    const newArtifact: RepositoryArtifactRecord = {
      ...oldArtifact,
      id: "artifact_new",
      identity: "apt:myapp:1.2.3:amd64",
      version: "1.2.3",
      summary: "myapp 1.2.3 amd64",
      publishedAt: "2026-07-12T00:01:00.000Z",
      updatedAt: "2026-07-12T00:01:00.000Z",
      publishSessionId: "pub_new",
    };
    await state.repositoryArtifacts.upsert(oldArtifact);
    await state.repositoryArtifacts.upsert({ ...newArtifact, repositoryName: "python-internal" });
    await state.repositoryArtifacts.upsert(newArtifact);

    await expect(state.repositoryArtifacts.listByRepository("debian-internal")).resolves.toEqual([
      newArtifact,
      oldArtifact,
    ]);
  });

});

describe("MemoryStateStore", () => {

});

describe("MemoryStateStore repository secrets", () => {

});

describe("MemoryStateStore repository activity deletion", () => {
});

describe("MemoryStateStore repository plugin policies", () => {
});

describeStateStoreContract("MemoryStateStore", () => new MemoryStateStore());
