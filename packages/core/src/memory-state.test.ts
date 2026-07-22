import { describe, expect, it } from "vitest";
import {
  MemoryStateStore,
  type PublishSession,
  type PublishTokenRecord,
  type SigningKeyRecord,
} from "./index";

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

describe("MemoryStateStore signing keys", () => {
  it("persists signing keys by id and name and lists them sorted", async () => {
    const state = new MemoryStateStore();
    await state.signingKeys.save(signingKey({ id: "signing_key_2", name: "zeta" }));
    await state.signingKeys.save(signingKey({ id: "signing_key_1", name: "alpha" }));

    await expect(state.signingKeys.getById("signing_key_1")).resolves.toMatchObject({
      name: "alpha",
    });
    await expect(state.signingKeys.getByName("zeta", "debian-internal")).resolves.toMatchObject({
      id: "signing_key_2",
    });
    await expect(state.signingKeys.list()).resolves.toMatchObject([
      { name: "alpha" },
      { name: "zeta" },
    ]);
  });

  it("keeps signing key name and id indexes consistent when a name changes", async () => {
    const state = new MemoryStateStore();
    await state.signingKeys.save(signingKey({ id: "signing_key_1", name: "old-name" }));
    await state.signingKeys.save(signingKey({ id: "signing_key_1", name: "new-name" }));

    await expect(state.signingKeys.getByName("old-name", "debian-internal")).resolves.toBeNull();
    await expect(state.signingKeys.getByName("new-name", "debian-internal")).resolves.toMatchObject({
      id: "signing_key_1",
    });
  });

  it("scopes signing key name indexes by repository", async () => {
    const state = new MemoryStateStore();
    await state.signingKeys.save(signingKey({ id: "signing_key_1", repositoryName: "debian-prod", name: "release" }));
    await state.signingKeys.save(signingKey({ id: "signing_key_2", repositoryName: "debian-staging", name: "release" }));

    await expect(state.signingKeys.getByName("release", "debian-prod")).resolves.toMatchObject({
      id: "signing_key_1",
    });
    await expect(state.signingKeys.getByName("release", "debian-staging")).resolves.toMatchObject({
      id: "signing_key_2",
    });
  });
});
