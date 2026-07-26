import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseCliArgs, parsePublishRequest, runCli } from "./cli";

async function writeRequestFile(request: Record<string, unknown>, artifactBytes = "deb-bytes") {
  const directory = await mkdtemp(join(tmpdir(), "axis-cli-"));
  const artifactPath = join(directory, "myapp_1.2.3_amd64.deb");
  await writeFile(artifactPath, artifactBytes);
  const requestPath = join(directory, "publish.json");
  await writeFile(requestPath, JSON.stringify({
    ...request,
    artifacts: [{
      path: artifactPath,
      contentType: "application/vnd.debian.binary-package",
      metadata: { package: "myapp" },
    }],
  }));
  return { requestPath, artifactPath };
}

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

describe("publish CLI runCli", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the token from the configured environment variable", async () => {
    const { requestPath } = await writeRequestFile({
      baseUrl: "https://axis.example",
      tokenEnv: "CUSTOM_TOKEN",
      repository: "debian-internal",
      ecosystem: "apt",
    });
    const requests: Array<{ url: string; authorization: string | null; body: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      requests.push({
        url,
        authorization: headers.get("authorization"),
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      });
      if (url.endsWith("/api/publish-sessions")) {
        return new Response(JSON.stringify({
          id: "pub_1",
          uploads: [{
            uploadId: "upl_1",
            filename: "myapp_1.2.3_amd64.deb",
            method: "PUT",
            url: "https://uploads.example/upl_1",
            headers: {},
          }],
        }), { status: 201, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await runCli(["--request", requestPath], { CUSTOM_TOKEN: "axis_publish_secret" });
    } finally {
      log.mockRestore();
    }

    const createRequest = requests.find((request) => request.url.endsWith("/api/publish-sessions"));
    expect(createRequest?.authorization).toBe("Bearer axis_publish_secret");
    // The filename defaults to the artifact path's basename, and size and
    // digest are computed from the file rather than declared in the request.
    expect(createRequest?.body).toMatchObject({
      repositoryName: "debian-internal",
      ecosystem: "apt",
      artifacts: [{
        filename: "myapp_1.2.3_amd64.deb",
        size: 9,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }],
    });
  });

  it("fails when no token is available", async () => {
    const { requestPath } = await writeRequestFile({
      baseUrl: "https://axis.example",
      repository: "debian-internal",
      ecosystem: "apt",
    });

    await expect(runCli(["--request", requestPath], {}))
      .rejects.toThrow("Publish token is required in AXIS_PUBLISH_TOKEN");
  });
});
