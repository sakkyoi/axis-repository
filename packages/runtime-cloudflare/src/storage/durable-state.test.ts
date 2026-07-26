import { describe, expect, it } from "vitest";
import type {
  SigningKeyRecord,
} from "@axis-repository/core";
import { describeStateStoreContract } from "@axis-repository/core/test-support";
import { DurableStateStore, type DurableStorage } from "./durable-state";

/**
 * Durable Object storage serializes on write and deserializes on read, so a
 * caller can never hold a reference into stored state. The fake has to do the
 * same or it is more permissive than production and would hide aliasing bugs.
 */
function serialized<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

class FakeDurableStorage implements DurableStorage {
  readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    const value = this.values.get(key);
    return value === undefined ? undefined : serialized(value as T);
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, serialized(value));
  }

  async delete(key: string): Promise<boolean> {
    return this.values.delete(key);
  }

  async list<T>(options?: { prefix?: string }): Promise<Map<string, T>> {
    const result = new Map<string, T>();
    for (const [key, value] of this.values) {
      if (!options?.prefix || key.startsWith(options.prefix)) {
        result.set(key, serialized(value as T));
      }
    }
    return result;
  }
}

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

describe("DurableStateStore", () => {

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

});

describeStateStoreContract("DurableStateStore", () => new DurableStateStore(new FakeDurableStorage()));
