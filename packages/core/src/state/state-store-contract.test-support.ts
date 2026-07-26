import { describe, expect, it } from "vitest";
import type {
  AdminRefreshSessionRecord,
  AdminUserRecord,
  PublishSession,
  PublishTokenRecord,
  Repository,
  RepositoryActivityRecord,
  RepositoryArtifactRecord,
  RepositorySecretRecord,
} from "../domain/domain";
import type { StateStore } from "../ports/ports";

function repository(overrides: Partial<Repository> = {}): Repository {
  return {
    id: "repo_1",
    name: "debian-internal",
    ecosystem: "apt",
    visibility: "private",
    config: { apt: { codename: "noble" } },
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
    ...overrides,
  };
}

function publishSession(overrides: Partial<PublishSession> = {}): PublishSession {
  return {
    id: "pub_1",
    repositoryName: "debian-internal",
    ecosystem: "apt",
    status: "pending_uploads",
    requestedBy: {
      tokenId: "ptok_1",
      name: "github-actions",
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
    name: "github-actions",
    tokenHash: "sha256:hash",
    permissions: ["publish"],
    repositories: ["debian-internal"],
    ecosystemScopes: {},
    signingKeyIds: [],
    createdAt: "2026-07-12T00:00:00.000Z",
    ...overrides,
  };
}

function adminUser(overrides: Partial<AdminUserRecord> = {}): AdminUserRecord {
  return {
    id: "admin_user_1",
    username: "admin",
    displayName: "admin",
    passwordHash: "sha256:hash",
    role: "owner",
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
    ...overrides,
  };
}

function adminRefreshSession(
  overrides: Partial<AdminRefreshSessionRecord> = {},
): AdminRefreshSessionRecord {
  return {
    id: "admin_session_1",
    subject: "admin_user_1",
    username: "admin",
    role: "owner",
    tokenHash: "sha256:hash",
    scopes: ["admin:*"],
    createdAt: "2026-07-12T00:00:00.000Z",
    expiresAt: "2026-08-11T00:00:00.000Z",
    ...overrides,
  };
}

function repositorySecret(overrides: Partial<RepositorySecretRecord> = {}): RepositorySecretRecord {
  return {
    id: "repository_secret_1",
    namespace: "apt.signing-key",
    repositoryName: "debian-internal",
    name: "release",
    publicMetadata: { fingerprint: "AAAA" },
    encryptedSecrets: { algorithm: "AES-GCM", iv: "iv", ciphertext: "cipher" },
    createdAt: "2026-07-12T00:00:00.000Z",
    ...overrides,
  };
}

function repositoryActivity(
  overrides: Partial<RepositoryActivityRecord> = {},
): RepositoryActivityRecord {
  return {
    id: "activity_1",
    repositoryName: "debian-internal",
    type: "object.delete",
    actor: "admin",
    summary: "Deleted pool/main/app.deb",
    metadata: {},
    createdAt: "2026-07-12T00:00:00.000Z",
    ...overrides,
  };
}

function repositoryArtifact(
  overrides: Partial<RepositoryArtifactRecord> = {},
): RepositoryArtifactRecord {
  // The cast is needed because exactOptionalPropertyTypes rejects merging a
  // Partial whose optional keys may be explicitly undefined; this is the only
  // record in the contract with optional fields.
  return {
    id: "artifact_1",
    repositoryName: "debian-internal",
    ecosystem: "apt",
    identity: "myapp/1.2.3/amd64",
    name: "myapp",
    summary: "myapp 1.2.3",
    objectKeys: ["repositories/debian-internal/pool/main/m/myapp/myapp_1.2.3_amd64.deb"],
    metadata: {},
    updatedAt: "2026-07-12T00:00:00.000Z",
    ...overrides,
  } as RepositoryArtifactRecord;
}

/**
 * Behaviour every StateStore adapter must share.
 *
 * The in-memory and Durable Object adapters back the same port, and drift
 * between them shows up as "works in dev, not in production" (or the reverse).
 * Both suites used to assert this by copy-paste; this is the single statement
 * of the contract, run against each adapter.
 */
export function describeStateStoreContract(
  name: string,
  createStore: () => StateStore | Promise<StateStore>,
): void {
  const store = async (): Promise<StateStore> => createStore();

  describe(`${name} StateStore contract`, () => {
    describe("repositories", () => {
      it("persists by name, lists sorted, and deletes", async () => {
        const state = await store();
        await state.repositories.save(repository({ id: "repo_2", name: "python-internal" }));
        await state.repositories.save(repository());

        await expect(state.repositories.getByName("debian-internal")).resolves.toMatchObject({ id: "repo_1" });
        await expect(state.repositories.getByName("missing")).resolves.toBeNull();
        await expect(state.repositories.list()).resolves.toMatchObject([
          { name: "debian-internal" },
          { name: "python-internal" },
        ]);
        await expect(state.repositories.deleteByName("debian-internal")).resolves.toBe(true);
        await expect(state.repositories.deleteByName("debian-internal")).resolves.toBe(false);
        await expect(state.repositories.list()).resolves.toHaveLength(1);
      });

      it("does not alias stored records to callers", async () => {
        const state = await store();
        await state.repositories.save(repository());

        const read = await state.repositories.getByName("debian-internal");
        read!.visibility = "public";
        (read!.config.apt as Record<string, unknown>).codename = "trixie";
        const [listed] = await state.repositories.list();
        listed!.name = "renamed";

        await expect(state.repositories.getByName("debian-internal")).resolves.toMatchObject({
          visibility: "private",
          config: { apt: { codename: "noble" } },
        });
      });
    });

    describe("aliasing", () => {
      // Services no longer copy defensively, so this has to hold for every
      // collection, on the way in and on the way out — not just repositories.
      it("does not alias what a caller saved", async () => {
        const state = await store();

        const savedToken = publishToken();
        await state.publishTokens.save(savedToken);
        savedToken.repositories.push("debian-staging");
        savedToken.permissions.push("read");

        const savedSecret = repositorySecret();
        await state.repositorySecrets.save(savedSecret);
        savedSecret.repositoryName = "attacker-repo";

        const savedSession = adminRefreshSession();
        await state.adminRefreshSessions.save(savedSession);
        savedSession.revokedAt = "2026-07-12T00:00:00.000Z";

        const savedArtifact = repositoryArtifact();
        await state.repositoryArtifacts.upsert(savedArtifact);
        savedArtifact.objectKeys.push("_staging/evil");

        await expect(state.publishTokens.getByName("github-actions")).resolves.toMatchObject({
          repositories: ["debian-internal"],
          permissions: ["publish"],
        });
        await expect(state.repositorySecrets.getById("repository_secret_1")).resolves.toMatchObject({
          repositoryName: "debian-internal",
        });
        await expect(state.adminRefreshSessions.get("admin_session_1"))
          .resolves.not.toHaveProperty("revokedAt");
        await expect(state.repositoryArtifacts.listByRepository("debian-internal")).resolves.toMatchObject([
          { objectKeys: ["repositories/debian-internal/pool/main/m/myapp/myapp_1.2.3_amd64.deb"] },
        ]);
      });

      it("does not alias what a caller read back", async () => {
        const state = await store();
        await state.publishTokens.save(publishToken());
        await state.repositorySecrets.save(repositorySecret());
        await state.adminRefreshSessions.save(adminRefreshSession());
        await state.publishSessions.save(publishSession());

        (await state.publishTokens.getById("ptok_1"))!.repositories.push("debian-staging");
        (await state.repositorySecrets.getById("repository_secret_1"))!.repositoryName = "attacker-repo";
        (await state.adminRefreshSessions.list())[0]!.role = "owner";
        const updated = await state.publishSessions.update("pub_1", (current) => ({ ...current, status: "ready" }));
        updated!.status = "finalized";

        await expect(state.publishTokens.getById("ptok_1")).resolves.toMatchObject({
          repositories: ["debian-internal"],
        });
        await expect(state.repositorySecrets.getById("repository_secret_1")).resolves.toMatchObject({
          repositoryName: "debian-internal",
        });
        await expect(state.publishSessions.get("pub_1")).resolves.toMatchObject({ status: "ready" });
      });
    });

    describe("publish sessions", () => {
      it("persists by id and lists newest first", async () => {
        const state = await store();
        await state.publishSessions.save(publishSession({ id: "pub_1", createdAt: "2026-07-12T00:00:00.000Z" }));
        await state.publishSessions.save(publishSession({ id: "pub_2", createdAt: "2026-07-12T00:05:00.000Z" }));

        await expect(state.publishSessions.get("pub_1")).resolves.toMatchObject({ id: "pub_1" });
        await expect(state.publishSessions.get("missing")).resolves.toBeNull();
        await expect(state.publishSessions.list()).resolves.toMatchObject([{ id: "pub_2" }, { id: "pub_1" }]);
      });

      it("updates from the latest stored value and does not save when the updater throws", async () => {
        const state = await store();
        await state.publishSessions.save(publishSession());

        await expect(state.publishSessions.update("pub_1", (current) => ({
          ...current,
          status: "ready",
        }))).resolves.toMatchObject({ status: "ready" });
        await expect(state.publishSessions.get("pub_1")).resolves.toMatchObject({ status: "ready" });

        await expect(state.publishSessions.update("pub_1", () => {
          throw new Error("rejected");
        })).rejects.toThrow("rejected");
        await expect(state.publishSessions.get("pub_1")).resolves.toMatchObject({ status: "ready" });

        await expect(state.publishSessions.update("missing", (current) => current)).resolves.toBeNull();
      });

      it("deletes only the requested repository's sessions", async () => {
        const state = await store();
        await state.publishSessions.save(publishSession({ id: "pub_1" }));
        await state.publishSessions.save(publishSession({ id: "pub_2" }));
        await state.publishSessions.save(publishSession({ id: "pub_other", repositoryName: "python-internal" }));

        await expect(state.publishSessions.deleteByRepository("debian-internal")).resolves.toBe(2);
        await expect(state.publishSessions.list()).resolves.toMatchObject([{ id: "pub_other" }]);
      });
    });

    describe("publish tokens", () => {
      it("keeps name and id indexes consistent across renames and reuse", async () => {
        const state = await store();
        await state.publishTokens.save(publishToken());

        await expect(state.publishTokens.getByName("github-actions")).resolves.toMatchObject({ id: "ptok_1" });
        await expect(state.publishTokens.getById("ptok_1")).resolves.toMatchObject({ name: "github-actions" });

        await state.publishTokens.save(publishToken({ name: "renamed" }));
        await expect(state.publishTokens.getByName("github-actions")).resolves.toBeNull();
        await expect(state.publishTokens.getByName("renamed")).resolves.toMatchObject({ id: "ptok_1" });

        // Reusing a name under a different id must evict the previous record
        // rather than leaving two rows fighting over one name.
        await state.publishTokens.save(publishToken({ id: "ptok_2", name: "renamed" }));
        await expect(state.publishTokens.getById("ptok_1")).resolves.toBeNull();
        await expect(state.publishTokens.getByName("renamed")).resolves.toMatchObject({ id: "ptok_2" });
      });

      it("deletes by name and clears both indexes", async () => {
        const state = await store();
        await state.publishTokens.save(publishToken());

        await expect(state.publishTokens.deleteByName("github-actions")).resolves.toBe(true);
        await expect(state.publishTokens.deleteByName("github-actions")).resolves.toBe(false);
        await expect(state.publishTokens.getById("ptok_1")).resolves.toBeNull();
        await expect(state.publishTokens.list()).resolves.toEqual([]);
      });
    });

    describe("admin users and sessions", () => {
      it("keeps username and id indexes consistent", async () => {
        const state = await store();
        await state.adminUsers.save(adminUser());

        await expect(state.adminUsers.getByUsername("admin")).resolves.toMatchObject({ id: "admin_user_1" });
        await state.adminUsers.save(adminUser({ username: "owner" }));
        await expect(state.adminUsers.getByUsername("admin")).resolves.toBeNull();
        await expect(state.adminUsers.getByUsername("owner")).resolves.toMatchObject({ id: "admin_user_1" });
        await expect(state.adminUsers.getById("admin_user_1")).resolves.toMatchObject({ username: "owner" });
      });

      it("persists refresh sessions by id", async () => {
        const state = await store();
        await state.adminRefreshSessions.save(adminRefreshSession());

        await expect(state.adminRefreshSessions.get("admin_session_1")).resolves.toMatchObject({
          subject: "admin_user_1",
        });
        await expect(state.adminRefreshSessions.get("missing")).resolves.toBeNull();
        await expect(state.adminRefreshSessions.list()).resolves.toHaveLength(1);
      });
    });

    describe("repository secrets", () => {
      it("scopes the name index by namespace and repository", async () => {
        const state = await store();
        await state.repositorySecrets.save(repositorySecret());
        await state.repositorySecrets.save(repositorySecret({
          id: "repository_secret_2",
          repositoryName: "python-internal",
        }));
        await state.repositorySecrets.save(repositorySecret({
          id: "repository_secret_3",
          namespace: "pypi",
        }));

        // Same name in three scopes must resolve to three different records.
        await expect(state.repositorySecrets.getByName("release", "debian-internal", "apt.signing-key"))
          .resolves.toMatchObject({ id: "repository_secret_1" });
        await expect(state.repositorySecrets.getByName("release", "python-internal", "apt.signing-key"))
          .resolves.toMatchObject({ id: "repository_secret_2" });
        await expect(state.repositorySecrets.getByName("release", "debian-internal", "pypi"))
          .resolves.toMatchObject({ id: "repository_secret_3" });
        await expect(state.repositorySecrets.getByName("release", "debian-internal", "npm"))
          .resolves.toBeNull();
      });

      it("deletes by repository and clears the name index", async () => {
        const state = await store();
        await state.repositorySecrets.save(repositorySecret());
        await state.repositorySecrets.save(repositorySecret({
          id: "repository_secret_other",
          repositoryName: "python-internal",
        }));

        await expect(state.repositorySecrets.deleteByRepository("debian-internal")).resolves.toBe(1);
        await expect(state.repositorySecrets.getByName("release", "debian-internal", "apt.signing-key"))
          .resolves.toBeNull();
        await expect(state.repositorySecrets.list()).resolves.toHaveLength(1);
      });
    });

    describe("repository activities", () => {
      it("lists a repository's activities newest first and deletes by repository", async () => {
        const state = await store();
        await state.repositoryActivities.save(repositoryActivity({ id: "activity_1" }));
        await state.repositoryActivities.save(repositoryActivity({
          id: "activity_2",
          createdAt: "2026-07-12T00:05:00.000Z",
        }));
        await state.repositoryActivities.save(repositoryActivity({
          id: "activity_other",
          repositoryName: "python-internal",
        }));

        await expect(state.repositoryActivities.listByRepository("debian-internal")).resolves.toMatchObject([
          { id: "activity_2" },
          { id: "activity_1" },
        ]);
        await expect(state.repositoryActivities.deleteByRepository("debian-internal")).resolves.toBe(2);
        await expect(state.repositoryActivities.listByRepository("python-internal")).resolves.toHaveLength(1);
      });
    });

    describe("repository artifacts", () => {
      it("replaces an artifact that reuses a repository identity", async () => {
        const state = await store();
        await state.repositoryArtifacts.upsert(repositoryArtifact());
        await state.repositoryArtifacts.upsert(repositoryArtifact({
          id: "artifact_2",
          summary: "myapp 1.2.3 rebuilt",
        }));

        await expect(state.repositoryArtifacts.listByRepository("debian-internal")).resolves.toMatchObject([
          { id: "artifact_2", summary: "myapp 1.2.3 rebuilt" },
        ]);
      });

      it("replaces one repository's artifacts without touching another's", async () => {
        const state = await store();
        await state.repositoryArtifacts.upsert(repositoryArtifact());
        await state.repositoryArtifacts.upsert(repositoryArtifact({
          id: "artifact_other",
          repositoryName: "python-internal",
          identity: "demo/1.0.0",
        }));

        await state.repositoryArtifacts.replaceByRepository("debian-internal", [
          repositoryArtifact({ id: "artifact_3", identity: "myapp/2.0.0/amd64" }),
        ]);

        await expect(state.repositoryArtifacts.listByRepository("debian-internal")).resolves.toMatchObject([
          { id: "artifact_3" },
        ]);
        await expect(state.repositoryArtifacts.listByRepository("python-internal")).resolves.toMatchObject([
          { id: "artifact_other" },
        ]);
      });
    });

    describe("repository plugin policies", () => {
      it("persists by ecosystem and lists sorted", async () => {
        const state = await store();
        await state.repositoryPluginPolicies.save({ ecosystem: "pypi", enabledOverride: false });
        await state.repositoryPluginPolicies.save({ ecosystem: "apt", enabledOverride: true });

        await expect(state.repositoryPluginPolicies.getByEcosystem("apt")).resolves.toEqual({
          ecosystem: "apt",
          enabledOverride: true,
        });
        await expect(state.repositoryPluginPolicies.getByEcosystem("npm")).resolves.toBeNull();
        await expect(state.repositoryPluginPolicies.list()).resolves.toEqual([
          { ecosystem: "apt", enabledOverride: true },
          { ecosystem: "pypi", enabledOverride: false },
        ]);
      });
    });
  });
}
