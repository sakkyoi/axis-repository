import { describe, expect, it } from "vitest";

import { parseCliArgs, parsePublishRequest } from "./cli";

describe("publish CLI", () => {
  it("parses --request path", () => {
    expect(parseCliArgs(["--request", "publish.json"])).toEqual({ requestPath: "publish.json" });
  });

  it("requires request path", () => {
    expect(() => parseCliArgs([])).toThrow("Usage: axis-publish --request <publish.json>");
  });

  it("parses publish request JSON", () => {
    expect(
      parsePublishRequest(
        JSON.stringify({
          baseUrl: "https://axis.example",
          tokenEnv: "AXIS_PUBLISH_TOKEN",
          repository: "debian-internal",
          ecosystem: "apt",
          artifacts: [
            {
              path: "./pkg.deb",
              filename: "pkg.deb",
              contentType: "application/vnd.debian.binary-package",
              metadata: { package: "pkg" },
            },
          ],
        }),
      ),
    ).toMatchObject({
      baseUrl: "https://axis.example",
      tokenEnv: "AXIS_PUBLISH_TOKEN",
      repository: "debian-internal",
      ecosystem: "apt",
      artifacts: [{ path: "./pkg.deb", filename: "pkg.deb" }],
    });
  });

  it("requires ecosystem", () => {
    expect(() =>
      parsePublishRequest(
        JSON.stringify({
          baseUrl: "https://axis.example",
          repository: "debian-internal",
          artifacts: [{ path: "./pkg.deb", contentType: "application/vnd.debian.binary-package", metadata: {} }],
        }),
      ),
    ).toThrow("ecosystem is required");
  });
});
