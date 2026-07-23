import { describe, expect, it } from "vitest";
import type { Repository, SigningKey } from "../../api/schemas";
import {
  activeSigningKeysForRepository,
  aptPublishTokenMissingSigningKeySelections,
} from "./token-scope";

describe("APT publish token scope", () => {
  it("requires signing key selection only for selected APT repositories when publish is enabled", () => {
    const repositories = [
      repository("debian-internal", "apt"),
      repository("python-internal", "pypi"),
    ];

    expect(aptPublishTokenMissingSigningKeySelections({
      repositories,
      selectedRepositories: ["debian-internal", "python-internal"],
      permissions: { read: false, publish: true },
      signingKeySelections: {},
    })).toEqual(["debian-internal"]);

    expect(aptPublishTokenMissingSigningKeySelections({
      repositories,
      selectedRepositories: ["debian-internal"],
      permissions: { read: true, publish: false },
      signingKeySelections: {},
    })).toEqual([]);
  });

  it("filters active signing keys scoped to a repository", () => {
    expect(activeSigningKeysForRepository([
      signingKey("signing_key_prod", "debian-internal"),
      { ...signingKey("signing_key_old", "debian-internal"), revokedAt: "2026-07-23T00:00:00.000Z" },
      signingKey("signing_key_other", "other-repo"),
    ], "debian-internal").map((key) => key.id)).toEqual(["signing_key_prod"]);
  });
});

function repository(name: string, ecosystem: string): Repository {
  return {
    id: `repo_${name}`,
    name,
    ecosystem,
    visibility: "private",
    config: {},
    createdAt: "2026-07-23T00:00:00.000Z",
    updatedAt: "2026-07-23T00:00:00.000Z",
  };
}

function signingKey(id: string, repositoryName: string): SigningKey {
  return {
    id,
    repositoryName,
    name: id,
    publicKeyArmored: "public",
    fingerprint: `fingerprint-${id}`,
    keyId: `key-${id}`,
    createdAt: "2026-07-23T00:00:00.000Z",
    revokedAt: null,
  };
}
