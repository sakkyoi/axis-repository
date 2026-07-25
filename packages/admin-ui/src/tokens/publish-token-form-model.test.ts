import { describe, expect, it } from "vitest";
import type { PublishToken, Repository } from "../api/schemas";
import {
  buildCreatePublishTokenInput,
  buildPublishTokenExpiresAt,
  initialPublishTokenSelection,
  repositoryDisplayLabel,
  revokePublishTokenDialogContent,
  publishTokenDetailBodyClass,
  publishTokenDetailActionRowClass,
  publishTokenRawMetadataClass,
  publishTokenRowStateClass,
  publishTokenSummaryItemClass,
  publishTokenSummaryItems,
  publishTokenSummaryValueClass,
  tokenScopeSummary,
} from "./publish-token-form-model";

describe("publish token form model", () => {
  it("builds a publish token payload from selected repositories, permissions, and signing keys", () => {
    expect(buildCreatePublishTokenInput({
      name: "github-actions",
      repositories: [
        repository("debian-internal", "apt", { apt: { signingKeyId: "signing_key_prod" } }),
        repository("python-internal", "pypi", {}),
      ],
      selectedRepositories: ["debian-internal", "python-internal"],
      permissions: { read: true, publish: true },
      expiration: { mode: "never", customDateTime: "" },
      now: new Date("2026-07-23T00:00:00.000Z"),
      scopeExtensions: [{
        deriveSigningKeyIds: ({ repositories }) =>
          repositories.flatMap((repository) =>
            repository.ecosystem === "apt" && typeof repository.config.apt === "object"
              ? [(repository.config.apt as { signingKeyId: string }).signingKeyId]
              : []),
        missingRequiredScopes: () => [],
      }],
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
      repositories: [repository("python-internal", "pypi", {})],
      selectedRepositories: ["python-internal"],
      permissions: { read: false, publish: true },
      expiration: { mode: "never", customDateTime: "" },
      now: new Date("2026-07-23T00:00:00.000Z"),
    })).toEqual({
      name: "pypi-actions",
      repositories: ["python-internal"],
      permissions: ["publish"],
      ecosystemScopes: {},
    });

    expect(buildCreatePublishTokenInput({
      name: "multi-apt",
      repositories: [
        repository("debian-a", "apt", { apt: { signingKeyId: "signing_key_shared" } }),
        repository("debian-b", "apt", { apt: { signingKeyId: "signing_key_shared" } }),
      ],
      selectedRepositories: ["debian-a", "debian-b"],
      permissions: { read: false, publish: true },
      expiration: { mode: "never", customDateTime: "" },
      now: new Date("2026-07-23T00:00:00.000Z"),
      scopeExtensions: [{
        deriveSigningKeyIds: ({ repositories }) =>
          repositories.flatMap((repository) =>
            repository.ecosystem === "apt" && typeof repository.config.apt === "object"
              ? [(repository.config.apt as { signingKeyId: string }).signingKeyId]
              : []),
        missingRequiredScopes: () => [],
      }],
    }).signingKeyIds).toEqual(["signing_key_shared"]);
  });

  it("omits signing key ids when publish permission is disabled", () => {
    expect(buildCreatePublishTokenInput({
      name: "reader",
      repositories: [repository("debian-internal", "apt", { apt: { signingKeyId: "signing_key_prod" } })],
      selectedRepositories: ["debian-internal"],
      permissions: { read: true, publish: false },
      expiration: { mode: "never", customDateTime: "" },
      now: new Date("2026-07-23T00:00:00.000Z"),
      scopeExtensions: [{
        deriveSigningKeyIds: () => ["signing_key_prod"],
        missingRequiredScopes: () => [],
      }],
    })).toEqual({
      name: "reader",
      repositories: ["debian-internal"],
      permissions: ["read"],
      ecosystemScopes: {},
    });
  });

  it("includes publish token expiration in create payloads", () => {
    expect(buildCreatePublishTokenInput({
      name: "github-actions",
      repositories: [repository("debian-internal", "apt", {})],
      selectedRepositories: ["debian-internal"],
      permissions: { read: false, publish: true },
      expiration: { mode: "1h", customDateTime: "" },
      now: new Date("2026-07-23T00:00:00.000Z"),
    })).toMatchObject({
      expiresAt: "2026-07-23T01:00:00.000Z",
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

  it("builds destructive dialog copy for revoking a publish token", () => {
    expect(revokePublishTokenDialogContent("github-actions")).toEqual({
      title: "Revoke publish token",
      description: "Revoke github-actions? Existing automation using this token will stop working.",
      confirmLabel: "Revoke token",
      pendingLabel: "Revoking...",
      confirmationText: "github-actions",
    });
  });

  it("does not preselect a publish token", () => {
    expect(initialPublishTokenSelection([publishToken("github-actions")])).toBeUndefined();
  });

  it("highlights only the selected publish token row", () => {
    expect(publishTokenRowStateClass("github-actions", "github-actions")).toContain("border-l-primary");
    expect(publishTokenRowStateClass("github-actions", "github-actions")).not.toContain("text-primary-foreground");
    expect(publishTokenRowStateClass("github-actions", undefined)).not.toContain("border-l-primary");
  });

  it("keeps publish token details packed at the top of the scroll area", () => {
    expect(publishTokenDetailBodyClass()).toContain("content-start");
    expect(publishTokenDetailBodyClass()).toContain("h-full");
    expect(publishTokenDetailBodyClass()).toContain("overflow-y-auto");
  });

  it("keeps publish token detail content contained inside the detail pane", () => {
    expect(publishTokenDetailActionRowClass()).toContain("justify-start");
    expect(publishTokenSummaryItemClass()).toContain("min-w-0");
    expect(publishTokenSummaryValueClass()).toContain("break-words");
    expect(publishTokenRawMetadataClass()).toContain("min-w-0");
    expect(publishTokenRawMetadataClass()).toContain("overflow-auto");
  });

  it("formats readonly publish token summary items", () => {
    expect(publishTokenSummaryItems(publishToken("github-actions"))).toEqual([
      ["Permissions", "publish"],
      ["Repositories", "debian-internal"],
      ["Signing key scopes", "signing_key_prod"],
      ["Created", "2026-07-23T00:00:00.000Z"],
      ["Expires", "never"],
    ]);
  });

  it("omits publish token expiration when set to never", () => {
    expect(buildPublishTokenExpiresAt({
      expiration: { mode: "never", customDateTime: "" },
      now: new Date("2026-07-23T00:00:00.000Z"),
    })).toBeUndefined();
  });

  it("builds relative publish token expirations from the current time", () => {
    expect(buildPublishTokenExpiresAt({
      expiration: { mode: "7d", customDateTime: "" },
      now: new Date("2026-07-23T00:00:00.000Z"),
    })).toBe("2026-07-30T00:00:00.000Z");
  });

  it("builds custom publish token expiration as an ISO string", () => {
    expect(buildPublishTokenExpiresAt({
      expiration: { mode: "custom", customDateTime: "2026-07-24T12:30" },
      now: new Date("2026-07-23T00:00:00.000Z"),
    })).toBe(new Date("2026-07-24T12:30").toISOString());
  });

  it("rejects invalid custom publish token expiration", () => {
    expect(() => buildPublishTokenExpiresAt({
      expiration: { mode: "custom", customDateTime: "" },
      now: new Date("2026-07-23T00:00:00.000Z"),
    })).toThrow("Custom expiration is required");
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

function publishToken(name: string): PublishToken {
  return {
    id: `ptok_${name}`,
    name,
    permissions: ["publish"],
    repositories: ["debian-internal"],
    ecosystemScopes: {},
    signingKeyIds: ["signing_key_prod"],
    createdAt: "2026-07-23T00:00:00.000Z",
  };
}
