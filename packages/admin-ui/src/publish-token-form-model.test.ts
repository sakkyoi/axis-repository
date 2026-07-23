import { describe, expect, it } from "vitest";
import type { Repository } from "./api/schemas";
import {
  buildCreatePublishTokenInput,
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
