import { describe, expect, it } from "vitest";

import type { PublishSession } from "@axis-repository/admin-ui/plugin-ui";
import { pypiPublishSessionArtifactSummary } from "./publish";

describe("PyPI publish UI plugin", () => {
  it("summarizes single PyPI artifact sessions by filename", () => {
    expect(pypiPublishSessionArtifactSummary(session())).toBe("demo-1.2.3-py3-none-any.whl, 0 verified");
  });
});

function session(): PublishSession {
  return {
    id: "pub_pypi",
    repositoryName: "python-internal",
    ecosystem: "pypi",
    status: "finalized",
    requestedBy: {
      tokenId: "tok_1",
      name: "ci",
    },
    artifacts: [{
      filename: "demo-1.2.3-py3-none-any.whl",
      size: 1234,
      sha256: "a".repeat(64),
      contentType: "application/zip",
      metadata: {},
    }],
    uploads: [],
    verifiedUploads: [],
    createdAt: "2026-07-23T00:00:00.000Z",
    expiresAt: "2026-07-23T00:10:00.000Z",
  };
}
