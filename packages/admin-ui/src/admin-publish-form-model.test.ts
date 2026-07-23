import { describe, expect, it } from "vitest";

import {
  buildAptPublishArtifact,
  defaultAptPublishFormValues,
  sha256Hex,
} from "./admin-publish-form-model";

describe("admin publish form model", () => {
  it("computes sha256 hex for uploaded bytes", async () => {
    expect(await sha256Hex(new Blob([new Uint8Array([1, 2, 3])]))).toBe(
      "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
    );
  });

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
});
