import { describe, expect, it, vi } from "vitest";
import type { PublishArtifact, PublishSession } from "./api/schemas";
import { publishRepositoryArtifacts } from "./repository-publish-flow";

const artifact: PublishArtifact = {
  filename: "demo_1.0.0_amd64.deb",
  size: 12,
  sha256: "a".repeat(64),
  contentType: "application/vnd.debian.binary-package",
  metadata: {},
};

const session: PublishSession = {
  id: "pub_1",
  repositoryName: "debian-internal",
  ecosystem: "apt",
  status: "pending_uploads",
  requestedBy: {
    tokenId: "admin",
    name: "admin",
    permissions: ["publish"],
    repositories: ["debian-internal"],
    ecosystemScopes: {},
    signingKeyIds: [],
  },
  artifacts: [artifact],
  uploads: [
    {
      uploadId: "upl_1",
      filename: artifact.filename,
      objectKey: "_staging/uploads/pub_1/upl_1/demo_1.0.0_amd64.deb",
      method: "PUT",
      url: "memory://upload",
      headers: {},
      expiresAt: "2026-07-23T00:10:00.000Z",
    },
  ],
  verifiedUploads: [],
  createdAt: "2026-07-23T00:00:00.000Z",
  expiresAt: "2026-07-23T00:10:00.000Z",
};

describe("repository publish flow", () => {
  it("creates, uploads, verifies, finalizes, and refreshes publish state in order", async () => {
    const calls: string[] = [];
    const file = new File(["demo"], artifact.filename);
    const refresh = vi.fn(async () => {
      calls.push("refresh");
    });

    await publishRepositoryArtifacts({
      repositoryName: "debian-internal",
      ecosystem: "apt",
      files: [file],
      artifacts: [artifact],
      createSession: vi.fn(async () => {
        calls.push("create");
        return session;
      }),
      uploadArtifact: vi.fn(async () => {
        calls.push("upload");
      }),
      verifyUpload: vi.fn(async () => {
        calls.push("verify");
      }),
      finalizeSession: vi.fn(async () => {
        calls.push("finalize");
      }),
      refresh,
      onStatus: (status) => calls.push(`status:${status}`),
    });

    expect(calls).toEqual([
      "status:Preparing artifacts...",
      "create",
      "status:Uploading artifacts...",
      "upload",
      "status:Verifying uploads...",
      "verify",
      "status:Finalizing repository...",
      "finalize",
      "refresh",
      "status:Published.",
    ]);
  });

  it("fails when the publish session does not return an upload target for each artifact", async () => {
    await expect(
      publishRepositoryArtifacts({
        repositoryName: "debian-internal",
        ecosystem: "apt",
        files: [new File(["demo"], artifact.filename)],
        artifacts: [artifact],
        createSession: async () => ({ ...session, uploads: [] }),
        uploadArtifact: async () => undefined,
        verifyUpload: async () => undefined,
        finalizeSession: async () => undefined,
        refresh: async () => undefined,
        onStatus: () => undefined,
      }),
    ).rejects.toThrow("Publish session did not return enough upload targets.");
  });
});
