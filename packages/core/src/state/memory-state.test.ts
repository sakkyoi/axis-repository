import { describe, expect, it } from "vitest";
import {
  MemoryStateStore,
  RepositoryActivityService,
  type PublishSession,
  type PublishTokenRecord,
  type RepositoryArtifactRecord,
  type RepositoryActivityRecord,
  type RepositorySecretRecord,
  type RepositoryPluginPolicyRecord,
  type SigningKeyRecord,
} from "../index";

const token = (overrides: Partial<PublishTokenRecord>): PublishTokenRecord => ({
  id: "tok_1",
  name: "publish-token",
  tokenHash: "hash_1",
  permissions: ["publish"],
  repositories: ["debian-internal"],
  ecosystemScopes: {},
  signingKeyIds: [],
  createdAt: "2026-07-12T00:00:00.000Z",
  ...overrides,
});

const session = (overrides: Partial<PublishSession>): PublishSession => ({
  id: "pub_1",
  repositoryName: "debian-internal",
  ecosystem: "apt",
  status: "ready",
  requestedBy: {
    tokenId: "tok_1",
    name: "publish-token",
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

  it("replaces an existing artifact with the same repository identity", async () => {
    const state = new MemoryStateStore();
    const artifact: RepositoryArtifactRecord = {
      id: "artifact_1",
      repositoryName: "debian-internal",
      ecosystem: "apt",
      identity: "apt:myapp:1.2.3:amd64",
      name: "myapp",
      version: "1.2.3",
      summary: "myapp 1.2.3 amd64",
      primaryObjectKey: "repositories/debian-internal/pool/main/m/myapp/myapp_1.2.3_amd64.deb",
      objectKeys: ["repositories/debian-internal/pool/main/m/myapp/myapp_1.2.3_amd64.deb"],
      metadata: { architecture: "amd64" },
      publishedAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-12T00:00:00.000Z",
      publishSessionId: "pub_1",
    };

    await state.repositoryArtifacts.upsert(artifact);
    await state.repositoryArtifacts.upsert({
      ...artifact,
      id: "artifact_2",
      primaryObjectKey: "repositories/debian-internal/pool/main/m/myapp/myapp_1.2.3_amd64.rebuilt.deb",
      objectKeys: ["repositories/debian-internal/pool/main/m/myapp/myapp_1.2.3_amd64.rebuilt.deb"],
      updatedAt: "2026-07-12T00:02:00.000Z",
      publishSessionId: "pub_2",
    });

    await expect(state.repositoryArtifacts.listByRepository("debian-internal")).resolves.toMatchObject([{
      id: "artifact_2",
      identity: "apt:myapp:1.2.3:amd64",
      publishSessionId: "pub_2",
    }]);
  });

  it("replaces all artifacts for one repository without touching others", async () => {
    const state = new MemoryStateStore();
    const oldArtifact: RepositoryArtifactRecord = {
      id: "artifact_old",
      repositoryName: "debian-internal",
      ecosystem: "apt",
      identity: "apt:main:old:1.0.0:amd64",
      name: "old",
      version: "1.0.0",
      summary: "old 1.0.0 amd64",
      objectKeys: [],
      metadata: {},
      publishedAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-12T00:00:00.000Z",
      publishSessionId: "pub_old",
    };
    const newArtifact = {
      ...oldArtifact,
      id: "artifact_new",
      identity: "apt:main:new:1.0.0:amd64",
      name: "new",
      summary: "new 1.0.0 amd64",
      publishSessionId: "pub_new",
    };
    await state.repositoryArtifacts.upsert(oldArtifact);
    await state.repositoryArtifacts.upsert({ ...oldArtifact, id: "artifact_other", repositoryName: "python-internal" });

    await state.repositoryArtifacts.replaceByRepository("debian-internal", [newArtifact]);

    await expect(state.repositoryArtifacts.listByRepository("debian-internal")).resolves.toEqual([newArtifact]);
    await expect(state.repositoryArtifacts.listByRepository("python-internal")).resolves.toMatchObject([{ id: "artifact_other" }]);
  });
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

describe("MemoryStateStore", () => {
  it("keeps publish token name indexes consistent when tokens are renamed", async () => {
    const state = new MemoryStateStore();

    await state.publishTokens.save(token({ id: "tok_1", name: "old-name" }));
    await state.publishTokens.save(token({ id: "tok_1", name: "new-name" }));

    expect(await state.publishTokens.getByName("old-name")).toBeNull();
    expect(await state.publishTokens.getByName("new-name")).toEqual(
      token({ id: "tok_1", name: "new-name" }),
    );
    expect(await state.publishTokens.list()).toEqual([token({ id: "tok_1", name: "new-name" })]);
  });

  it("replaces the previous token when a name is reused by another id", async () => {
    const state = new MemoryStateStore();

    await state.publishTokens.save(token({ id: "tok_1", name: "shared-name" }));
    await state.publishTokens.save(token({ id: "tok_2", name: "shared-name" }));

    expect(await state.publishTokens.getById("tok_1")).toBeNull();
    expect(await state.publishTokens.getByName("shared-name")).toEqual(
      token({ id: "tok_2", name: "shared-name" }),
    );
    expect(await state.publishTokens.list()).toEqual([token({ id: "tok_2", name: "shared-name" })]);
  });

  it("compare-and-sets publish session status only when the expected status matches", async () => {
    const state = new MemoryStateStore();
    await state.publishSessions.save(session({ status: "ready" }));

    await expect(
      state.publishSessions.compareAndSetStatus(
        "pub_1",
        "ready",
        session({ status: "finalizing" }),
      ),
    ).resolves.toBe(true);
    await expect(state.publishSessions.get("pub_1")).resolves.toMatchObject({
      status: "finalizing",
    });

    await expect(
      state.publishSessions.compareAndSetStatus(
        "pub_1",
        "ready",
        session({ status: "finalized" }),
      ),
    ).resolves.toBe(false);
    await expect(state.publishSessions.get("pub_1")).resolves.toMatchObject({
      status: "finalizing",
    });
  });

  it("does not compare-and-set a publish session with a mismatched replacement id", async () => {
    const state = new MemoryStateStore();
    const original = session({ status: "ready" });
    await state.publishSessions.save(original);

    await expect(
      state.publishSessions.compareAndSetStatus(
        "pub_1",
        "ready",
        session({ id: "pub_2", status: "finalizing" }),
      ),
    ).resolves.toBe(false);

    await expect(state.publishSessions.get("pub_1")).resolves.toEqual(original);
    await expect(state.publishSessions.get("pub_2")).resolves.toBeNull();
  });

  it("lists publish sessions sorted by created time descending", async () => {
    const state = new MemoryStateStore();
    await state.publishSessions.save(session({ id: "pub_old", createdAt: "2026-07-12T00:00:00.000Z" }));
    await state.publishSessions.save(session({ id: "pub_new", createdAt: "2026-07-12T00:02:00.000Z" }));
    await state.publishSessions.save(session({ id: "pub_mid", createdAt: "2026-07-12T00:01:00.000Z" }));

    await expect(state.publishSessions.list()).resolves.toMatchObject([
      { id: "pub_new" },
      { id: "pub_mid" },
      { id: "pub_old" },
    ]);
  });

  it("updates publish sessions from the latest value and does not save when the updater throws", async () => {
    const state = new MemoryStateStore();
    await state.publishSessions.save(session({ status: "pending_uploads" }));

    await state.publishSessions.save(session({ status: "ready" }));
    const updated = await state.publishSessions.update("pub_1", (current) => ({
      ...current,
      status: "finalizing",
    }));

    expect(updated).toEqual(session({ status: "finalizing" }));
    await expect(state.publishSessions.get("pub_1")).resolves.toEqual(
      session({ status: "finalizing" }),
    );

    await expect(
      state.publishSessions.update("pub_1", (current) => {
        current.status = "failed";
        current.failure = {
          message: "partial",
          failedAt: "2026-07-12T00:00:00.000Z",
        };
        throw new Error(`stop before saving ${current.status}`);
      }),
    ).rejects.toThrow("stop before saving failed");
    await expect(state.publishSessions.get("pub_1")).resolves.toEqual(
      session({ status: "finalizing" }),
    );
  });
});

describe("MemoryStateStore repository secrets", () => {
  it("persists repository secrets by id and scoped name and lists them sorted", async () => {
    const state = new MemoryStateStore();
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
    const state = new MemoryStateStore();
    await state.repositorySecrets.save(repositorySecret({ id: "repository_secret_1", name: "old-name" }));
    await state.repositorySecrets.save(repositorySecret({ id: "repository_secret_1", name: "new-name" }));

    await expect(state.repositorySecrets.getByName("old-name", "debian-internal", "apt.signing-key")).resolves.toBeNull();
    await expect(state.repositorySecrets.getByName("new-name", "debian-internal", "apt.signing-key")).resolves.toMatchObject({
      id: "repository_secret_1",
    });
  });

  it("scopes repository secret name indexes by repository and namespace", async () => {
    const state = new MemoryStateStore();
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

});

describe("MemoryStateStore repository plugin policies", () => {
  it("persists plugin policies by ecosystem and lists them sorted", async () => {
    const state = new MemoryStateStore();
    const apt: RepositoryPluginPolicyRecord = { ecosystem: "apt", enabledOverride: false };
    const pypi: RepositoryPluginPolicyRecord = { ecosystem: "pypi", enabledOverride: null };

    await state.repositoryPluginPolicies.save(pypi);
    await state.repositoryPluginPolicies.save(apt);

    await expect(state.repositoryPluginPolicies.getByEcosystem("apt")).resolves.toEqual(apt);
    await expect(state.repositoryPluginPolicies.list()).resolves.toEqual([apt, pypi]);
  });
});
