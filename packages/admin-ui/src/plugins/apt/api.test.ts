import { describe, expect, it } from "vitest";
import { listAptSigningKeys, generateAptSigningKey, importAptSigningKey, revokeAptSigningKey } from "./api";

describe("APT UI plugin API adapter", () => {
  it("uses generic repository plugin resources for signing keys", async () => {
    const calls: Array<{ method: string; repositoryName: string; namespace: string; path: string[]; input?: unknown }> = [];
    const client = {
      getRepositoryPluginResource: async (repositoryName: string, namespace: string, path: string[]) => {
        calls.push({ method: "GET", repositoryName, namespace, path });
        return {
          signingKeys: [
            {
              id: "signing_key_1",
              repositoryName: "debian-prod",
              name: "release",
              publicKeyArmored: "-----BEGIN PGP PUBLIC KEY BLOCK-----",
              fingerprint: "FINGERPRINT",
              keyId: "KEYID",
              createdAt: "2026-07-22T00:00:00.000Z",
              revokedAt: null,
            },
          ],
        };
      },
      postRepositoryPluginResource: async (repositoryName: string, namespace: string, path: string[], input: unknown) => {
        calls.push({ method: "POST", repositoryName, namespace, path, input });
        return {
          id: "signing_key_1",
          repositoryName: "debian-prod",
          name: "release",
          publicKeyArmored: "-----BEGIN PGP PUBLIC KEY BLOCK-----",
          fingerprint: "FINGERPRINT",
          keyId: "KEYID",
          createdAt: "2026-07-22T00:00:00.000Z",
          revokedAt: null,
        };
      },
    };

    await expect(listAptSigningKeys(client, "debian-prod")).resolves.toHaveLength(1);
    await generateAptSigningKey(client, "debian-prod", {
      name: "release",
      userIdName: "Axis Repository",
      userIdEmail: "axis@example.test",
    });
    await importAptSigningKey(client, "debian-prod", {
      name: "release",
      privateKeyArmored: "private",
      passphrase: "secret",
    });
    await revokeAptSigningKey(client, "debian-prod", "signing_key_1");

    expect(calls).toEqual([
      { method: "GET", repositoryName: "debian-prod", namespace: "apt", path: ["signing-keys"] },
      {
        method: "POST",
        repositoryName: "debian-prod",
        namespace: "apt",
        path: ["signing-keys", "generate"],
        input: {
          name: "release",
          userIdName: "Axis Repository",
          userIdEmail: "axis@example.test",
        },
      },
      {
        method: "POST",
        repositoryName: "debian-prod",
        namespace: "apt",
        path: ["signing-keys", "import"],
        input: {
          name: "release",
          privateKeyArmored: "private",
          passphrase: "secret",
        },
      },
      {
        method: "POST",
        repositoryName: "debian-prod",
        namespace: "apt",
        path: ["signing-keys", "signing_key_1", "revoke"],
        input: undefined,
      },
    ]);
  });
});
