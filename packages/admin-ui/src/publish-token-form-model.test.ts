import { describe, expect, it } from "vitest";
import type { Repository, SigningKey } from "./api/schemas";
import {
  activeSigningKeysForRepository,
  buildCreatePublishTokenInput,
  publishTokenNeedsSigningKeySelection,
  repositoryDisplayLabel,
  tokenScopeSummary,
} from "./publish-token-form-model";

describe("publish token form model", () => {
  it("builds a publish token payload from selected repositories, permissions, and signing keys", () => {
    expect(buildCreatePublishTokenInput({
      name: "github-actions",
      selectedRepositories: ["debian-internal", "python-internal"],
      permissions: { read: true, publish: true },
      signingKeySelections: {
        "debian-internal": "signing_key_prod",
      },
    })).toEqual({
      name: "github-actions",
      repositories: ["debian-internal", "python-internal"],
      permissions: ["read", "publish"],
      ecosystemScopes: {},
      signingKeyIds: ["signing_key_prod"],
    });
  });

  it("deduplicates signing key ids and omits them when none are selected", () => {
    expect(buildCreatePublishTokenInput({
      name: "pypi-actions",
      selectedRepositories: ["python-internal"],
      permissions: { read: false, publish: true },
      signingKeySelections: {},
    })).toEqual({
      name: "pypi-actions",
      repositories: ["python-internal"],
      permissions: ["publish"],
      ecosystemScopes: {},
    });

    expect(buildCreatePublishTokenInput({
      name: "multi-apt",
      selectedRepositories: ["debian-a", "debian-b"],
      permissions: { read: false, publish: true },
      signingKeySelections: {
        "debian-a": "signing_key_shared",
        "debian-b": "signing_key_shared",
      },
    }).signingKeyIds).toEqual(["signing_key_shared"]);
  });

  it("omits signing key ids when publish permission is disabled", () => {
    expect(buildCreatePublishTokenInput({
      name: "reader",
      selectedRepositories: ["debian-internal"],
      permissions: { read: true, publish: false },
      signingKeySelections: {
        "debian-internal": "signing_key_prod",
      },
    })).toEqual({
      name: "reader",
      repositories: ["debian-internal"],
      permissions: ["read"],
      ecosystemScopes: {},
    });
  });

  it("requires signing key selection only for selected APT repositories when publish is enabled", () => {
    const repositories = [
      repository("debian-internal", "apt", { apt: { signingKeyId: "signing_key_prod" } }),
      repository("python-internal", "pypi", { pypi: {} }),
    ];

    expect(publishTokenNeedsSigningKeySelection({
      repositories,
      selectedRepositories: ["debian-internal", "python-internal"],
      permissions: { read: false, publish: true },
      signingKeySelections: {},
    })).toEqual(["debian-internal"]);

    expect(publishTokenNeedsSigningKeySelection({
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

  it("builds readable repository and token scope summaries", () => {
    expect(repositoryDisplayLabel(repository("debian-internal", "apt", {}))).toBe("debian-internal (apt)");
    expect(tokenScopeSummary({
      repositories: ["debian-internal"],
      permissions: ["publish"],
      signingKeyIds: ["signing_key_prod"],
    })).toEqual({
      repositories: "debian-internal",
      permissions: "publish",
      signingKeys: "signing_key_prod",
    });
  });
});

function repository(name: string, ecosystem: string, config: Record<string, unknown>): Repository {
  return {
    id: `repo_${name}`,
    name,
    ecosystem,
    visibility: "private",
    config,
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
