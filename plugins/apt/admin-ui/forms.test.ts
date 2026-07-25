import { describe, expect, it } from "vitest";
import {
  activeSigningKeys,
  buildAptRepositoryFormValues,
  buildCreateAptRepositoryInput,
  buildUpdateAptRepositoryInput,
} from "./forms";
import type { Repository, SigningKey } from "@axis-repository/admin-ui/plugin-ui";

describe("APT repository forms", () => {
  it("builds create input from typed APT repository values", () => {
    expect(buildCreateAptRepositoryInput({
      name: "debian-internal",
      visibility: "private",
      codename: "noble",
      components: "",
      architectures: "",
      signingKeyMode: "generate",
      signingKeyName: "release",
      signingKeyUserIdName: "Axis Repository",
      signingKeyUserIdEmail: "axis@example.test",
      signingKeyPrivateKeyArmored: "",
      signingKeyPassphrase: "",
      signingKeyExistingId: "",
    })).toEqual({
      name: "debian-internal",
      ecosystem: "apt",
      visibility: "private",
      config: {
        apt: {
          codename: "noble",
        },
      },
      provisioning: {
        apt: {
          signingKey: {
            mode: "generate",
            name: "release",
            userIdName: "Axis Repository",
            userIdEmail: "axis@example.test",
          },
        },
      },
    });
  });

  it("rejects incomplete APT repository values", () => {
    expect(() =>
      buildCreateAptRepositoryInput({
        name: "",
        visibility: "private",
        codename: "",
        components: "",
        architectures: "",
        signingKeyMode: "generate",
        signingKeyName: "",
        signingKeyUserIdName: "",
        signingKeyUserIdEmail: "",
        signingKeyPrivateKeyArmored: "",
        signingKeyPassphrase: "",
        signingKeyExistingId: "",
      }),
    ).toThrow("Repository name is required");
  });

  it("builds create input for importing an APT signing key during repository creation", () => {
    expect(buildCreateAptRepositoryInput({
      name: "debian-internal",
      visibility: "private",
      codename: "noble",
      components: "",
      architectures: "",
      signingKeyMode: "import",
      signingKeyName: "release",
      signingKeyUserIdName: "",
      signingKeyUserIdEmail: "",
      signingKeyPrivateKeyArmored: "-----BEGIN PGP PRIVATE KEY BLOCK-----",
      signingKeyPassphrase: "secret",
      signingKeyExistingId: "",
    })).toMatchObject({
      provisioning: {
        apt: {
          signingKey: {
            mode: "import",
            name: "release",
            privateKeyArmored: "-----BEGIN PGP PRIVATE KEY BLOCK-----",
            passphrase: "secret",
          },
        },
      },
    });
  });

  it("builds edit form defaults and update input from an existing APT repository", () => {
    const repository: Repository = {
      id: "repo_1",
      name: "debian-internal",
      ecosystem: "apt",
      visibility: "private",
      config: {
        apt: {
          codename: "noble",
          components: ["main", "contrib"],
          architectures: ["amd64"],
          signingKeyId: "signing_key_prod",
        },
      },
      createdAt: "2026-07-22T00:00:00.000Z",
      updatedAt: "2026-07-22T00:00:00.000Z",
    };

    expect(buildAptRepositoryFormValues(repository)).toEqual({
      name: "debian-internal",
      visibility: "private",
      codename: "noble",
      components: "main contrib",
      architectures: "amd64",
      signingKeyId: "signing_key_prod",
      signingKeyMode: "existing",
      signingKeyName: "",
      signingKeyUserIdName: "",
      signingKeyUserIdEmail: "",
      signingKeyPrivateKeyArmored: "",
      signingKeyPassphrase: "",
      signingKeyExistingId: "signing_key_prod",
    });
    expect(buildUpdateAptRepositoryInput({
      name: "ignored",
      visibility: "public",
      codename: "jammy",
      components: "",
      architectures: "",
      signingKeyId: "signing_key_prod",
    })).toEqual({
      visibility: "public",
      config: {
        apt: {
          codename: "jammy",
          signingKeyId: "signing_key_prod",
        },
      },
    });
  });

  it("filters revoked signing keys out of repository form choices", () => {
    const keys = [
      signingKey({ id: "signing_key_active", revokedAt: null }),
      signingKey({ id: "signing_key_revoked", revokedAt: "2026-07-22T00:00:00.000Z" }),
    ];

    expect(activeSigningKeys(keys).map((key) => key.id)).toEqual(["signing_key_active"]);
  });
});

function signingKey(overrides: Partial<SigningKey>): SigningKey {
  return {
    id: "signing_key_prod",
    repositoryName: "debian-internal",
    name: "debian-prod",
    publicKeyArmored: "-----BEGIN PGP PUBLIC KEY BLOCK-----",
    fingerprint: "fingerprint",
    keyId: "key-id",
    createdAt: "2026-07-22T00:00:00.000Z",
    revokedAt: null,
    ...overrides,
  };
}
