import { describe, expect, it } from "vitest";
import {
  activeSigningKeys,
  applyAptRepositoryFieldChange,
  aptSuitesFor,
  emptyAptSettings,
  buildAptRepositoryFormValues,
  buildCreateAptRepositoryInput,
  buildUpdateAptRepositoryInput,
  signingKeySetupPanelClass,
} from "./forms";
import type { Repository, SigningKey } from "@axis-repository/admin-ui/plugin-ui";
import type { AptRepositoryFormValues } from "./forms";

describe("APT repository forms", () => {
  it("builds create input from typed APT repository values", () => {
    expect(buildCreateAptRepositoryInput({
      ...emptyAptSettings,
      name: "debian-internal",
      visibility: "private",
      codename: "noble",
      components: "",
      architectures: "",
      signingMode: "axis",
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
        ...emptyAptSettings,
        name: "",
        visibility: "private",
        codename: "",
      components: "",
      architectures: "",
      signingMode: "axis",
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
      ...emptyAptSettings,
      name: "debian-internal",
      visibility: "private",
      codename: "noble",
      components: "",
      architectures: "",
      signingMode: "axis",
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
      kind: "hosted",
      visibility: "private",
      config: {
        apt: {
          codename: "noble",
          components: ["main", "contrib"],
          architectures: ["amd64"],
          signing: { mode: "axis", signingKeyId: "signing_key_prod" },
        },
      },
      createdAt: "2026-07-22T00:00:00.000Z",
      updatedAt: "2026-07-22T00:00:00.000Z",
    };

    expect(buildAptRepositoryFormValues(repository)).toEqual({
      ...emptyAptSettings,
      name: "debian-internal",
      visibility: "private",
      codename: "noble",
      components: "main contrib",
      architectures: "amd64",
      signingMode: "axis",
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
      ...emptyAptSettings,
      name: "ignored",
      visibility: "public",
      codename: "jammy",
      components: "",
      architectures: "",
      signingMode: "axis",
      signingKeyId: "signing_key_prod",
    })).toEqual({
      visibility: "public",
      config: {
        apt: {
          codename: "jammy",
          signing: { mode: "axis", signingKeyId: "signing_key_prod" },
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

  it("keeps signing key setup controls separated from the heading", () => {
    expect(signingKeySetupPanelClass()).toContain("gap-4");
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

describe("APT settings that describe the Release", () => {
  const repository = (apt: Record<string, unknown>): Repository => ({
    id: "repo_1",
    name: "debian-internal",
    ecosystem: "apt",
    kind: "hosted",
    visibility: "public",
    config: { apt: { codename: "noble", signing: { mode: "axis", signingKeyId: "signing_key_prod" }, ...apt } },
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
  });

  it("keeps config the form does not know about instead of deleting it", () => {
    // The advanced JSON editor can set anything, and a plugin release can add
    // keys this build has never heard of. Saving the settings form rebuilds
    // config.apt, so anything it did not carry across would simply vanish.
    const stored = repository({ somethingThisBuildDoesNotKnow: { nested: true } });

    const input = buildUpdateAptRepositoryInput(buildAptRepositoryFormValues(stored), stored);

    expect((input.config?.apt as Record<string, unknown>).somethingThisBuildDoesNotKnow)
      .toEqual({ nested: true });
  });

  it("round-trips every Release setting through the form", () => {
    const stored = repository({
      suites: ["noble", "jammy"],
      origin: "Example Ltd",
      label: "Example packages",
      version: "24.04",
      description: "Internal builds",
      validityDays: 30,
      notAutomatic: true,
      butAutomaticUpgrades: true,
      acquireByHash: false,
      signedBy: ["0123456789ABCDEF0123456789ABCDEF01234567", "FEDCBA9876543210FEDCBA9876543210FEDCBA98!"],
      noSupportForArchitectureAll: ["Packages"],
    });

    const values = buildAptRepositoryFormValues(stored);
    expect(values).toMatchObject({
      suites: "noble jammy",
      origin: "Example Ltd",
      label: "Example packages",
      version: "24.04",
      description: "Internal builds",
      validityDays: "30",
      notAutomatic: true,
      butAutomaticUpgrades: true,
      acquireByHash: false,
      signedBy: "0123456789ABCDEF0123456789ABCDEF01234567 FEDCBA9876543210FEDCBA9876543210FEDCBA98!",
      noSupportForArchitectureAll: "Packages",
    });

    expect(buildUpdateAptRepositoryInput(values, stored).config?.apt).toMatchObject({
      suites: ["noble", "jammy"],
      origin: "Example Ltd",
      version: "24.04",
      validityDays: 30,
      notAutomatic: true,
      butAutomaticUpgrades: true,
      acquireByHash: false,
      signedBy: ["0123456789ABCDEF0123456789ABCDEF01234567", "FEDCBA9876543210FEDCBA9876543210FEDCBA98!"],
      noSupportForArchitectureAll: ["Packages"],
    });
  });

  it("drops a setting that has been cleared rather than writing an empty one", () => {
    const stored = repository({
      origin: "Example Ltd",
      validityDays: 30,
      notAutomatic: true,
      signedBy: ["0123456789ABCDEF0123456789ABCDEF01234567"],
      noSupportForArchitectureAll: ["Packages"],
    });

    const input = buildUpdateAptRepositoryInput({
      ...buildAptRepositoryFormValues(stored),
      origin: "",
      validityDays: "",
      notAutomatic: false,
      signedBy: "",
      noSupportForArchitectureAll: "",
    }, stored);

    const apt = input.config?.apt as Record<string, unknown>;
    expect(apt).not.toHaveProperty("origin");
    expect(apt).not.toHaveProperty("validityDays");
    expect(apt).not.toHaveProperty("notAutomatic");
    expect(apt).not.toHaveProperty("signedBy");
    expect(apt).not.toHaveProperty("noSupportForArchitectureAll");
  });

  it("stores by-hash only when it is turned off, since it defaults to on", () => {
    const stored = repository({});

    const on = buildUpdateAptRepositoryInput(buildAptRepositoryFormValues(stored), stored);
    expect(on.config?.apt).not.toHaveProperty("acquireByHash");

    const off = buildUpdateAptRepositoryInput(
      { ...buildAptRepositoryFormValues(stored), acquireByHash: false },
      stored,
    );
    expect((off.config?.apt as Record<string, unknown>).acquireByHash).toBe(false);
  });

  it("clears automatic upgrade pinning when NotAutomatic is turned off", () => {
    const values = buildAptRepositoryFormValues(repository({
      notAutomatic: true,
      butAutomaticUpgrades: true,
    }));

    expect(applyAptRepositoryFieldChange(values, "notAutomatic", false)).toMatchObject({
      notAutomatic: false,
      butAutomaticUpgrades: false,
    });
  });

  it("rejects settings the server would reject, without a round trip", () => {
    const stored = repository({});
    const values = buildAptRepositoryFormValues(stored);

    expect(() => buildUpdateAptRepositoryInput({ ...values, validityDays: "0" }, stored))
      .toThrow("Release validity must be a whole number of days");
    expect(() => buildUpdateAptRepositoryInput({ ...values, validityDays: "1.5" }, stored))
      .toThrow("Release validity must be a whole number of days");
    // apt ignores ButAutomaticUpgrades without NotAutomatic, so it reads as
    // applied when it is not.
    expect(() => buildUpdateAptRepositoryInput({ ...values, butAutomaticUpgrades: true }, stored))
      .toThrow("But automatic upgrades requires Not automatic");
    expect(() => buildUpdateAptRepositoryInput(
      { ...values, suites: "noble jammy", suite: "stable" },
      stored,
    )).toThrow("Suite override cannot be set for a repository publishing more than one suite");
    expect(() => buildUpdateAptRepositoryInput({ ...values, signedBy: "not-a-fingerprint" }, stored))
      .toThrow("Signed-By fingerprints must be OpenPGP fingerprints");
    expect(() => buildUpdateAptRepositoryInput({ ...values, noSupportForArchitectureAll: "Packages/../../bad" }, stored))
      .toThrow("No support for Architecture: all contains unsafe values");
  });
});

describe("suites in the create wizard", () => {
  const values = (overrides: Partial<AptRepositoryFormValues> = {}): AptRepositoryFormValues => ({
    ...emptyAptSettings,
    name: "debian-internal",
    visibility: "private",
    codename: "noble",
    components: "",
    architectures: "",
    signingMode: "axis",
    signingKeyMode: "generate",
    signingKeyName: "release",
    signingKeyUserIdName: "Axis Repository",
    signingKeyUserIdEmail: "axis@example.test",
    signingKeyPrivateKeyArmored: "",
    signingKeyPassphrase: "",
    signingKeyExistingId: "",
    ...overrides,
  });

  it("omits suites entirely when the repository just uses its codename", () => {
    expect(buildCreateAptRepositoryInput(values()).config.apt).not.toHaveProperty("suites");
    expect(aptSuitesFor(values())).toEqual([]);
  });

  it("carries a suite list into the created repository", () => {
    const input = buildCreateAptRepositoryInput(values({ suites: "noble jammy" }));

    expect((input.config.apt as Record<string, unknown>).suites).toEqual(["noble", "jammy"]);
  });

  it("refuses a list that leaves out the codename, which every default publish needs", () => {
    expect(() => buildCreateAptRepositoryInput(values({ suites: "jammy bookworm" })))
      .toThrow("Suites must include the codename");
  });

  it("accepts commas as well as spaces, since both read naturally", () => {
    expect(aptSuitesFor(values({ suites: "noble, jammy" }))).toEqual(["noble", "jammy"]);
  });
});
