import { describe, expect, it } from "vitest";

import type { PublishSession } from "../../api/schemas";
import {
  aptPublishSessionArtifactSummary,
  buildAptPublishArtifact,
  defaultAptPublishFormValues,
} from "./publish-model";

describe("APT publish model", () => {
  it("builds APT publish artifact metadata from form values and file", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "myapp_1.2.3_amd64.deb", {
      type: "application/vnd.debian.binary-package",
    });

    await expect(
      buildAptPublishArtifact(file, {
        packageName: "myapp",
        version: "1.2.3",
        architecture: "amd64",
        component: "main",
        description: "My app",
        maintainer: "Release Team <release@example.com>",
        section: "utils",
        priority: "optional",
      }),
    ).resolves.toMatchObject({
      filename: "myapp_1.2.3_amd64.deb",
      size: 3,
      contentType: "application/vnd.debian.binary-package",
      sha256: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
      metadata: {
        package: "myapp",
        version: "1.2.3",
        architecture: "amd64",
        component: "main",
        description: "My app",
        maintainer: "Release Team <release@example.com>",
        section: "utils",
        priority: "optional",
      },
    });
  });

  it("infers default APT values from Debian package filenames", () => {
    expect(defaultAptPublishFormValues("myapp_1.2.3_amd64.deb")).toMatchObject({
      packageName: "myapp",
      version: "1.2.3",
      architecture: "amd64",
      component: "main",
      section: "utils",
      priority: "optional",
    });
  });

  it("summarizes single APT package sessions from plugin metadata", () => {
    expect(aptPublishSessionArtifactSummary(session())).toBe("myapp 1.2.3 amd64, 0 verified");
  });
});

function session(): PublishSession {
  return {
    id: "pub_apt",
    repositoryName: "debian-internal",
    ecosystem: "apt",
    status: "finalized",
    requestedBy: {
      tokenId: "tok_1",
      name: "ci",
      permissions: ["publish"],
      repositories: ["debian-internal"],
      ecosystemScopes: {},
      signingKeyIds: [],
    },
    artifacts: [{
      filename: "myapp_1.2.3_amd64.deb",
      size: 1234,
      sha256: "a".repeat(64),
      contentType: "application/vnd.debian.binary-package",
      metadata: { package: "myapp", version: "1.2.3", architecture: "amd64" },
    }],
    uploads: [],
    verifiedUploads: [],
    createdAt: "2026-07-23T00:00:00.000Z",
    expiresAt: "2026-07-23T00:10:00.000Z",
  };
}
