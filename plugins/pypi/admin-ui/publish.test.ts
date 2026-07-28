import { describe, expect, it } from "vitest";

import type { PublishSession } from "@axis-repository/admin-ui/plugin-ui";
import { pypiPublishSessionArtifactSummary } from "./publish";
import { pypiUploadCommandText } from "./detail";

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

describe("PyPI upload hints", () => {
  const repository = {
    id: "repo_1",
    name: "python-internal",
    ecosystem: "pypi",
    visibility: "private" as const,
    config: {},
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
  };

  it("points twine at the upload endpoint, not the index", () => {
    // Uploading to the Simple index URL is the mistake this hint exists to
    // prevent; they are different endpoints.
    const text = pypiUploadCommandText(repository);

    expect(text).toContain("/repositories/python-internal/legacy/");
    expect(text).not.toContain("/simple/");
  });

  it("uses the __token__ username those clients expect", () => {
    expect(pypiUploadCommandText(repository)).toContain("TWINE_USERNAME=__token__");
  });

  it("never writes a real token into the hint", () => {
    expect(pypiUploadCommandText(repository)).toContain("<PUBLISH_TOKEN>");
  });
});
