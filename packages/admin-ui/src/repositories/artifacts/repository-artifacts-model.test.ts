import { describe, expect, it } from "vitest";
import type { RepositoryArtifact } from "../../api/schemas";
import {
  repositoryArtifactDeleteDialogContent,
  repositoryArtifactObjectRelativePath,
} from "./repository-artifacts-model";

const artifact = (overrides: Partial<RepositoryArtifact> = {}): RepositoryArtifact => ({
  id: "artifact_1",
  repositoryName: "debian-internal",
  ecosystem: "apt",
  identity: "apt:main:myapp:1.2.3:amd64",
  name: "myapp",
  version: "1.2.3",
  summary: "myapp 1.2.3 amd64",
  primaryObjectKey: "repositories/debian-internal/pool/main/myapp/myapp_1.2.3_amd64.deb",
  objectKeys: ["repositories/debian-internal/pool/main/myapp/myapp_1.2.3_amd64.deb"],
  metadata: {},
  publishedAt: "2026-07-24T00:00:00.000Z",
  updatedAt: "2026-07-24T00:00:00.000Z",
  publishSessionId: "pub_1",
  ...overrides,
});

describe("repository artifacts model", () => {
  it("builds destructive dialog copy for deleting an artifact", () => {
    expect(repositoryArtifactDeleteDialogContent(artifact())).toEqual({
      title: "Delete artifact",
      description:
        "Delete myapp 1.2.3 amd64? This removes the artifact objects from storage and rebuilds the repository artifact index.",
      confirmLabel: "Delete artifact",
      pendingLabel: "Deleting...",
      confirmationText: "delete artifact",
    });
  });

  it("maps artifact object keys to repository-relative browser paths", () => {
    expect(
      repositoryArtifactObjectRelativePath(
        "debian-internal",
        "repositories/debian-internal/pool/main/myapp/myapp_1.2.3_amd64.deb",
      ),
    ).toBe("pool/main/myapp/myapp_1.2.3_amd64.deb");
  });

  it("does not expose object keys outside the repository namespace", () => {
    expect(
      repositoryArtifactObjectRelativePath(
        "debian-internal",
        "repositories/other/pool/main/myapp/myapp_1.2.3_amd64.deb",
      ),
    ).toBeUndefined();
  });
});
