import { describe, expect, it } from "vitest";
import {
  MemoryStateStore,
  NotFoundError,
  RepositoryService,
  ValidationError,
  type Clock,
  type PublishTokenRecord,
  type RepositoryActivityRecord,
  type RepositoryArtifactRecord,
  type RepositorySecretRecord,
  type RandomId,
} from "../index";

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

  it("deletes repositories and cascades repository-owned state", async () => {
    const state = new MemoryStateStore();
    const service = new RepositoryService({ state, clock, randomId });
    await service.create({
      name: "debian-internal",
      ecosystem: "apt",
      visibility: "private",
      config: {},
    });
    await state.repositoryArtifacts.upsert(artifact({ repositoryName: "debian-internal" }));
    await state.repositoryArtifacts.upsert(artifact({ id: "artifact_other", repositoryName: "python-internal" }));
    await state.repositoryActivities.save(activity({ repositoryName: "debian-internal" }));
    await state.repositoryActivities.save(activity({ id: "activity_other", repositoryName: "python-internal" }));
    await state.repositorySecrets.save(secret({ repositoryName: "debian-internal" }));
    await state.repositorySecrets.save(secret({ id: "repository_secret_other", repositoryName: "python-internal" }));
    await state.publishSessions.save(session({ repositoryName: "debian-internal" }));
    await state.publishSessions.save(session({ id: "pub_other", repositoryName: "python-internal" }));
    await state.publishTokens.save(publishToken({
      name: "multi",
      repositories: ["debian-internal", "python-internal"],
      signingKeyIds: ["repository_secret_1", "repository_secret_other"],
    }));
    await state.publishTokens.save(publishToken({
      id: "ptok_single",
      name: "single",
      repositories: ["debian-internal"],
    }));

    await service.delete("debian-internal");

    await expect(service.getByName("debian-internal")).rejects.toBeInstanceOf(NotFoundError);
    await expect(state.repositoryArtifacts.listByRepository("debian-internal")).resolves.toEqual([]);
    await expect(state.repositoryActivities.listByRepository("debian-internal")).resolves.toEqual([]);
    await expect(state.repositorySecrets.getByName("release", "debian-internal", "apt.signing-key")).resolves.toBeNull();
    await expect(state.publishSessions.list()).resolves.toMatchObject([{ id: "pub_other" }]);
    const multiToken = await state.publishTokens.getByName("multi");
    expect(multiToken).toMatchObject({
      repositories: ["python-internal"],
      signingKeyIds: ["repository_secret_other"],
    });
    expect(multiToken).not.toHaveProperty("revokedAt");
    await expect(state.publishTokens.getByName("single")).resolves.toMatchObject({
      repositories: [],
      revokedAt: "2026-07-13T00:00:00.000Z",
    });
    await expect(state.repositoryArtifacts.listByRepository("python-internal")).resolves.toMatchObject([{ id: "artifact_other" }]);
    await expect(state.repositoryActivities.listByRepository("python-internal")).resolves.toMatchObject([{ id: "activity_other" }]);
  });

  it("rejects deleting missing repositories", async () => {
    const service = new RepositoryService({ state: new MemoryStateStore(), clock, randomId });

    await expect(service.delete("missing")).rejects.toBeInstanceOf(NotFoundError);
  });
});

function artifact(overrides: Partial<RepositoryArtifactRecord> = {}): RepositoryArtifactRecord {
  return {
    id: "artifact_1",
    repositoryName: "debian-internal",
    ecosystem: "apt",
    identity: "apt:main:myapp:1.2.3:amd64",
    name: "myapp",
    version: "1.2.3",
    summary: "myapp 1.2.3 amd64",
    primaryObjectKey: "repositories/debian-internal/pool/main/myapp.deb",
    objectKeys: ["repositories/debian-internal/pool/main/myapp.deb"],
    metadata: {},
    publishedAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
    publishSessionId: "pub_1",
    ...overrides,
  };
}

function activity(overrides: Partial<RepositoryActivityRecord> = {}): RepositoryActivityRecord {
  return {
    id: "activity_1",
    repositoryName: "debian-internal",
    type: "object.delete",
    actor: "admin",
    summary: "Deleted pool/main/myapp.deb",
    metadata: {},
    createdAt: "2026-07-12T00:00:00.000Z",
    ...overrides,
  };
}

function secret(overrides: Partial<RepositorySecretRecord> = {}): RepositorySecretRecord {
  return {
    id: "repository_secret_1",
    namespace: "apt.signing-key",
    repositoryName: "debian-internal",
    name: "release",
    publicMetadata: {},
    encryptedSecrets: {
      algorithm: "AES-GCM",
      iv: "iv",
      ciphertext: "ciphertext",
    },
    createdAt: "2026-07-12T00:00:00.000Z",
    ...overrides,
  };
}

function session(overrides: Partial<import("../index").PublishSession> = {}): import("../index").PublishSession {
  return {
    id: "pub_1",
    repositoryName: "debian-internal",
    ecosystem: "apt",
    status: "ready",
    requestedBy: {
      tokenId: "ptok_1",
      name: "ci",
      permissions: ["publish"],
      repositories: ["debian-internal"],
      ecosystemScopes: {},
      signingKeyIds: [],
    },
    artifacts: [],
    uploads: [],
    verifiedUploads: [],
    createdAt: "2026-07-12T00:00:00.000Z",
    expiresAt: "2026-07-12T00:15:00.000Z",
    ...overrides,
  };
}

function publishToken(overrides: Partial<PublishTokenRecord> = {}): PublishTokenRecord {
  return {
    id: "ptok_1",
    name: "ci",
    tokenHash: "hash",
    permissions: ["publish"],
    repositories: ["debian-internal"],
    ecosystemScopes: {},
    signingKeyIds: [],
    createdAt: "2026-07-12T00:00:00.000Z",
    ...overrides,
  };
}
