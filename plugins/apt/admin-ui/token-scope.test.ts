import { describe, expect, it } from "vitest";
import type { Repository } from "@axis-repository/admin-ui/plugin-ui";
import {
  aptPublishTokenMissingRequiredScopes,
  aptPublishTokenSigningKeyIds,
} from "./token-scope";

describe("APT publish token scope", () => {
  it("derives signing key scopes from selected APT repositories when publish is enabled", () => {
    const repositories = [
      repository("debian-internal", "apt", { apt: { signingKeyId: "signing_key_prod" } }),
      repository("python-internal", "pypi"),
    ];

    expect(aptPublishTokenSigningKeyIds({
      repositories,
      selectedRepositories: ["debian-internal", "python-internal"],
      permissions: { read: false, publish: true },
    })).toEqual(["signing_key_prod"]);

    expect(aptPublishTokenSigningKeyIds({
      repositories,
      selectedRepositories: ["debian-internal"],
      permissions: { read: true, publish: false },
    })).toEqual([]);
  });

  it("reports selected APT repositories that still need signing key setup", () => {
    const repositories = [
      repository("debian-ready", "apt", { apt: { signingKeyId: "signing_key_prod" } }),
      repository("debian-missing", "apt"),
      repository("python-internal", "pypi"),
    ];

    expect(aptPublishTokenMissingRequiredScopes({
      repositories,
      selectedRepositories: ["debian-ready", "debian-missing", "python-internal"],
      permissions: { read: false, publish: true },
    })).toEqual(["debian-missing"]);
  });
});

function repository(name: string, ecosystem: string, config: Record<string, unknown> = {}): Repository {
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
