import { describe, expect, it } from "vitest";
import type {
  PublishSession,
  PublishTokenRecord,
  AdminUserRecord,
  Repository,
  RepositoryArtifactRecord,
  RepositoryActivityRecord,
  RepositorySecretRecord,
  RepositoryPluginPolicyRecord,
  SigningKeyRecord,
} from "@axis-repository/core";
import { DurableStateStore, type DurableStorage } from "./durable-state";

const adminUser = (overrides: Partial<AdminUserRecord>): AdminUserRecord => ({
  id: "admin_user_1",
  username: "admin",
  displayName: "admin",
  passwordHash: "hash",
  role: "owner",
  createdAt: "2026-07-26T00:00:00.000Z",
  updatedAt: "2026-07-26T00:00:00.000Z",
  ...overrides,
});

class FakeDurableStorage implements DurableStorage {
  readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<boolean> {
    return this.values.delete(key);
  }

  async list<T>(options?: { prefix?: string }): Promise<Map<string, T>> {
    const result = new Map<string, T>();
    for (const [key, value] of this.values) {
      if (!options?.prefix || key.startsWith(options.prefix)) {
        result.set(key, value as T);
      }
    }
    return result;
  }
}

const repository: Repository = {
  id: "repo_1",
  name: "debian-internal",
  ecosystem: "apt",
  visibility: "private",
  config: { codenames: ["noble"] },
  createdAt: "2026-07-14T00:00:00.000Z",
  updatedAt: "2026-07-14T00:00:00.000Z",
};

const publishSession = (overrides: Partial<PublishSession>): PublishSession => ({
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
  createdAt: "2026-07-14T00:00:00.000Z",
  expiresAt: "2026-07-14T00:15:00.000Z",
  ...overrides,
});

const signingKey = (overrides: Partial<SigningKeyRecord> = {}): SigningKeyRecord => ({
  id: "signing_key_1",
  repositoryName: "debian-internal",
  name: "debian-prod",
  publicKeyArmored: "-----BEGIN PGP PUBLIC KEY BLOCK-----\n...\n-----END PGP PUBLIC KEY BLOCK-----",
  encryptedPrivateKeyArmored: {
    algorithm: "AES-GCM",
    iv: "iv",
    ciphertext: "private",
  },
  encryptedPassphrase: {
    algorithm: "AES-GCM",
    iv: "iv2",
    ciphertext: "passphrase",
  },
  fingerprint: "A".repeat(40),
  keyId: "B".repeat(16),
  createdAt: "2026-07-18T00:00:00.000Z",
  ...overrides,
});

const repositoryActivity = (overrides: Partial<RepositoryActivityRecord> = {}): RepositoryActivityRecord => ({
  id: "activity_1",
  repositoryName: "debian-internal",
  type: "object.delete",
  actor: "admin",
  summary: "Deleted pool/main/app.deb",
  metadata: {
    path: "pool/main/app.deb",
    objectKey: "repositories/debian-internal/pool/main/app.deb",
  },
  createdAt: "2026-07-14T00:00:00.000Z",
  ...overrides,
});

const repositoryArtifact = (overrides: Partial<RepositoryArtifactRecord> = {}): RepositoryArtifactRecord => ({
  id: "artifact_1",
  repositoryName: "debian-internal",
  ecosystem: "apt",
  identity: "apt:main:myapp:1.2.3:amd64",
  name: "myapp",
  version: "1.2.3",
  summary: "myapp 1.2.3 amd64",
  primaryObjectKey: "repositories/debian-internal/pool/main/myapp/myapp_1.2.3_amd64.deb",
  objectKeys: ["repositories/debian-internal/pool/main/myapp/myapp_1.2.3_amd64.deb"],
  metadata: { architecture: "amd64" },
  publishedAt: "2026-07-14T00:00:00.000Z",
  updatedAt: "2026-07-14T00:00:00.000Z",
  publishSessionId: "pub_1",
  ...overrides,
});

const repositorySecret = (overrides: Partial<RepositorySecretRecord> = {}): RepositorySecretRecord => ({
  id: "repository_secret_1",
  namespace: "apt.signing-key",
  repositoryName: "debian-internal",
  name: "debian-prod",
  publicMetadata: {
    publicKeyArmored: "-----BEGIN PGP PUBLIC KEY BLOCK-----",
    fingerprint: "A".repeat(40),
    keyId: "B".repeat(16),
  },
  encryptedSecrets: {
    algorithm: "AES-GCM",
    iv: "iv",
    ciphertext: "private",
  },
  createdAt: "2026-07-18T00:00:00.000Z",
  ...overrides,
});

describe("DurableStateStore", () => {
  it("persists repositories by name and lists them sorted", async () => {
    const storage = new FakeDurableStorage();
    const state = new DurableStateStore(storage);

    await state.repositories.save({
      ...repository,
      name: "python-internal",
      ecosystem: "pypi",
    });
    await state.repositories.save(repository);

    await expect(state.repositories.getByName("debian-internal")).resolves.toEqual(
      repository,
    );
    await expect(state.repositories.list()).resolves.toMatchObject([
      { name: "debian-internal" },
      { name: "python-internal" },
    ]);
  });

  it("deletes repositories by name", async () => {
    const state = new DurableStateStore(new FakeDurableStorage());
    await state.repositories.save(repository);

    await expect(state.repositories.deleteByName("debian-internal")).resolves.toBe(true);

    await expect(state.repositories.getByName("debian-internal")).resolves.toBeNull();
    await expect(state.repositories.deleteByName("debian-internal")).resolves.toBe(false);
  });

  it("persists publish sessions by id", async () => {
    const state = new DurableStateStore(new FakeDurableStorage());
    const session = publishSession({ status: "pending_uploads" });

    await state.publishSessions.save(session);

    await expect(state.publishSessions.get("pub_1")).resolves.toEqual(session);
  });

  it("compare-and-sets publish session status only when the expected status matches", async () => {
    const state = new DurableStateStore(new FakeDurableStorage());
    await state.publishSessions.save(publishSession({ status: "ready" }));

    await expect(
      state.publishSessions.compareAndSetStatus(
        "pub_1",
        "ready",
        publishSession({ status: "finalizing" }),
      ),
    ).resolves.toBe(true);
    await expect(state.publishSessions.get("pub_1")).resolves.toMatchObject({
      status: "finalizing",
    });

    await expect(
      state.publishSessions.compareAndSetStatus(
        "pub_1",
        "ready",
        publishSession({ status: "finalized" }),
      ),
    ).resolves.toBe(false);
    await expect(state.publishSessions.get("pub_1")).resolves.toMatchObject({
      status: "finalizing",
    });
  });

  it("does not compare-and-set a publish session with a mismatched replacement id", async () => {
    const state = new DurableStateStore(new FakeDurableStorage());
    const original = publishSession({ status: "ready" });
    await state.publishSessions.save(original);

    await expect(
      state.publishSessions.compareAndSetStatus(
        "pub_1",
        "ready",
        publishSession({ id: "pub_2", status: "finalizing" }),
      ),
    ).resolves.toBe(false);

    await expect(state.publishSessions.get("pub_1")).resolves.toEqual(original);
    await expect(state.publishSessions.get("pub_2")).resolves.toBeNull();
  });

  it("lists publish sessions sorted by created time descending", async () => {
    const state = new DurableStateStore(new FakeDurableStorage());
    await state.publishSessions.save(publishSession({ id: "pub_old", createdAt: "2026-07-14T00:00:00.000Z" }));
    await state.publishSessions.save(publishSession({ id: "pub_new", createdAt: "2026-07-14T00:02:00.000Z" }));
    await state.publishSessions.save(publishSession({ id: "pub_mid", createdAt: "2026-07-14T00:01:00.000Z" }));

    await expect(state.publishSessions.list()).resolves.toMatchObject([
      { id: "pub_new" },
      { id: "pub_mid" },
      { id: "pub_old" },
    ]);
  });

  it("deletes publish sessions by repository", async () => {
    const state = new DurableStateStore(new FakeDurableStorage());
    await state.publishSessions.save(publishSession({ id: "pub_1", repositoryName: "debian-internal" }));
    await state.publishSessions.save(publishSession({ id: "pub_2", repositoryName: "debian-internal" }));
    await state.publishSessions.save(publishSession({ id: "pub_other", repositoryName: "python-internal" }));

    await expect(state.publishSessions.deleteByRepository("debian-internal")).resolves.toBe(2);

    await expect(state.publishSessions.list()).resolves.toMatchObject([{ id: "pub_other" }]);
  });

  it("persists repository activities and lists newest first by repository", async () => {
    const state = new DurableStateStore(new FakeDurableStorage());
    const oldActivity = repositoryActivity({ id: "activity_old", createdAt: "2026-07-14T00:00:00.000Z" });
    const newActivity = repositoryActivity({ id: "activity_new", createdAt: "2026-07-14T00:02:00.000Z" });

    await state.repositoryActivities.save(oldActivity);
    await state.repositoryActivities.save({ ...newActivity, repositoryName: "python-internal" });
    await state.repositoryActivities.save(newActivity);

    await expect(state.repositoryActivities.listByRepository("debian-internal")).resolves.toEqual([
      newActivity,
      oldActivity,
    ]);
  });

  it("deletes repository activities by repository", async () => {
    const state = new DurableStateStore(new FakeDurableStorage());
    await state.repositoryActivities.save(repositoryActivity({ id: "activity_1", repositoryName: "debian-internal" }));
    await state.repositoryActivities.save(repositoryActivity({ id: "activity_other", repositoryName: "python-internal" }));

    await expect(state.repositoryActivities.deleteByRepository("debian-internal")).resolves.toBe(1);

    await expect(state.repositoryActivities.listByRepository("debian-internal")).resolves.toEqual([]);
    await expect(state.repositoryActivities.listByRepository("python-internal")).resolves.toMatchObject([{ id: "activity_other" }]);
  });

  it("updates publish sessions from the latest value and does not save when the updater throws", async () => {
    const state = new DurableStateStore(new FakeDurableStorage());
    await state.publishSessions.save(publishSession({ status: "pending_uploads" }));

    await state.publishSessions.save(publishSession({ status: "ready" }));
    const updated = await state.publishSessions.update("pub_1", (current) => ({
      ...current,
      status: "finalizing",
    }));

    expect(updated).toEqual(publishSession({ status: "finalizing" }));
    await expect(state.publishSessions.get("pub_1")).resolves.toEqual(
      publishSession({ status: "finalizing" }),
    );

    await expect(
      state.publishSessions.update("pub_1", (current) => {
        current.status = "failed";
        current.failure = {
          message: "partial",
          failedAt: "2026-07-14T00:00:00.000Z",
        };
        throw new Error(`stop before saving ${current.status}`);
      }),
    ).rejects.toThrow("stop before saving failed");
    await expect(state.publishSessions.get("pub_1")).resolves.toEqual(
      publishSession({ status: "finalizing" }),
    );
  });

  it("keeps publish token name and id indexes consistent", async () => {
    const state = new DurableStateStore(new FakeDurableStorage());
    const original: PublishTokenRecord = {
      id: "ptok_1",
      name: "old-name",
      tokenHash: "hash",
      permissions: ["publish"],
      repositories: ["debian-internal"],
      ecosystemScopes: {},
      signingKeyIds: [],
      createdAt: "2026-07-14T00:00:00.000Z",
    };

    await state.publishTokens.save(original);
    await state.publishTokens.save({ ...original, name: "new-name" });

    await expect(state.publishTokens.getByName("old-name")).resolves.toBeNull();
    await expect(state.publishTokens.getByName("new-name")).resolves.toMatchObject({
      id: "ptok_1",
    });
  });

  it("deletes publish tokens by name and clears indexes", async () => {
    const state = new DurableStateStore(new FakeDurableStorage());
    const original: PublishTokenRecord = {
      id: "ptok_1",
      name: "github-actions",
      tokenHash: "hash",
      permissions: ["publish"],
      repositories: ["debian-internal"],
      ecosystemScopes: {},
      signingKeyIds: [],
      createdAt: "2026-07-14T00:00:00.000Z",
    };

    await state.publishTokens.save(original);

    await expect(state.publishTokens.deleteByName("github-actions")).resolves.toBe(true);
    await expect(state.publishTokens.getById("ptok_1")).resolves.toBeNull();
    await expect(state.publishTokens.getByName("github-actions")).resolves.toBeNull();
    await expect(state.publishTokens.list()).resolves.toEqual([]);
    await expect(state.publishTokens.deleteByName("github-actions")).resolves.toBe(false);
  });

  it("keeps admin user username and id indexes consistent", async () => {
    const state = new DurableStateStore(new FakeDurableStorage());

    await state.adminUsers.save(adminUser({ id: "admin_user_1", username: "old-admin" }));
    await state.adminUsers.save(adminUser({ id: "admin_user_1", username: "admin" }));

    await expect(state.adminUsers.getByUsername("old-admin")).resolves.toBeNull();
    await expect(state.adminUsers.getByUsername("admin")).resolves.toMatchObject({
      id: "admin_user_1",
      username: "admin",
    });
    await expect(state.adminUsers.list()).resolves.toMatchObject([
      { id: "admin_user_1", username: "admin" },
    ]);
  });

  it("persists repository secrets by id and scoped name and lists them sorted", async () => {
    const state = new DurableStateStore(new FakeDurableStorage());
    await state.repositorySecrets.save(repositorySecret({ id: "repository_secret_2", name: "zeta" }));
    await state.repositorySecrets.save(repositorySecret({ id: "repository_secret_1", name: "alpha" }));

    await expect(state.repositorySecrets.getById("repository_secret_1")).resolves.toMatchObject({
      name: "alpha",
    });
    await expect(state.repositorySecrets.getByName("zeta", "debian-internal", "apt.signing-key")).resolves.toMatchObject({
      id: "repository_secret_2",
    });
    await expect(state.repositorySecrets.list()).resolves.toMatchObject([
      { name: "alpha" },
      { name: "zeta" },
    ]);
  });

  it("keeps repository secret name and id indexes consistent when a name changes", async () => {
    const state = new DurableStateStore(new FakeDurableStorage());
    await state.repositorySecrets.save(repositorySecret({ id: "repository_secret_1", name: "old-name" }));
    await state.repositorySecrets.save(repositorySecret({ id: "repository_secret_1", name: "new-name" }));

    await expect(state.repositorySecrets.getByName("old-name", "debian-internal", "apt.signing-key")).resolves.toBeNull();
    await expect(state.repositorySecrets.getByName("new-name", "debian-internal", "apt.signing-key")).resolves.toMatchObject({
      id: "repository_secret_1",
    });
  });

  it("scopes repository secret name indexes by repository and namespace", async () => {
    const state = new DurableStateStore(new FakeDurableStorage());
    await state.repositorySecrets.save(repositorySecret({ id: "repository_secret_1", repositoryName: "debian-prod", name: "release" }));
    await state.repositorySecrets.save(repositorySecret({ id: "repository_secret_2", repositoryName: "debian-staging", name: "release" }));
    await state.repositorySecrets.save(repositorySecret({ id: "repository_secret_3", repositoryName: "debian-prod", name: "release", namespace: "npm.token" }));

    await expect(state.repositorySecrets.getByName("release", "debian-prod", "apt.signing-key")).resolves.toMatchObject({
      id: "repository_secret_1",
    });
    await expect(state.repositorySecrets.getByName("release", "debian-staging", "apt.signing-key")).resolves.toMatchObject({
      id: "repository_secret_2",
    });
    await expect(state.repositorySecrets.getByName("release", "debian-prod", "npm.token")).resolves.toMatchObject({
      id: "repository_secret_3",
    });
  });

  it("deletes repository secrets by repository and clears name indexes", async () => {
    const state = new DurableStateStore(new FakeDurableStorage());
    await state.repositorySecrets.save(repositorySecret({ id: "repository_secret_1", repositoryName: "debian-internal", name: "release" }));
    await state.repositorySecrets.save(repositorySecret({ id: "repository_secret_2", repositoryName: "debian-internal", name: "staging" }));
    await state.repositorySecrets.save(repositorySecret({ id: "repository_secret_other", repositoryName: "python-internal", name: "release" }));

    await expect(state.repositorySecrets.deleteByRepository("debian-internal")).resolves.toBe(2);

    await expect(state.repositorySecrets.getByName("release", "debian-internal", "apt.signing-key")).resolves.toBeNull();
    await expect(state.repositorySecrets.getByName("release", "python-internal", "apt.signing-key")).resolves.toMatchObject({
      id: "repository_secret_other",
    });
  });

  it("reads legacy signing key storage through repository secrets", async () => {
    const storage = new FakeDurableStorage();
    await storage.put("signing-key:signing_key_1", signingKey({ id: "signing_key_1", repositoryName: "debian-prod", name: "release" }));
    await storage.put("signing-key-name:debian-prod:release", "signing_key_1");
    const state = new DurableStateStore(storage);

    await expect(state.repositorySecrets.getById("signing_key_1")).resolves.toMatchObject({
      id: "signing_key_1",
      name: "release",
    });
    await expect(state.repositorySecrets.list()).resolves.toMatchObject([{ id: "signing_key_1" }]);
  });

  it("persists repository plugin policies by ecosystem and lists them sorted", async () => {
    const state = new DurableStateStore(new FakeDurableStorage());
    const apt: RepositoryPluginPolicyRecord = { ecosystem: "apt", enabledOverride: false };
    const pypi: RepositoryPluginPolicyRecord = { ecosystem: "pypi", enabledOverride: null };

    await state.repositoryPluginPolicies.save(pypi);
    await state.repositoryPluginPolicies.save(apt);

    await expect(state.repositoryPluginPolicies.getByEcosystem("apt")).resolves.toEqual(apt);
    await expect(state.repositoryPluginPolicies.list()).resolves.toEqual([apt, pypi]);
  });

  it("upserts repository artifacts by repository identity", async () => {
    const state = new DurableStateStore(new FakeDurableStorage());
    await state.repositoryArtifacts.upsert(repositoryArtifact({ id: "artifact_old", updatedAt: "2026-07-14T00:00:00.000Z" }));
    await state.repositoryArtifacts.upsert(repositoryArtifact({
      id: "artifact_new",
      primaryObjectKey: "repositories/debian-internal/pool/main/myapp/myapp_1.2.3_amd64.rebuilt.deb",
      objectKeys: ["repositories/debian-internal/pool/main/myapp/myapp_1.2.3_amd64.rebuilt.deb"],
      updatedAt: "2026-07-14T00:02:00.000Z",
      publishSessionId: "pub_2",
    }));

    await expect(state.repositoryArtifacts.listByRepository("debian-internal")).resolves.toMatchObject([{
      id: "artifact_new",
      identity: "apt:main:myapp:1.2.3:amd64",
      publishSessionId: "pub_2",
    }]);
  });
});
