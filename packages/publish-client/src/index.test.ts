import { describe, expect, it } from "vitest";

import { createPublishClient } from "./index";

describe("publish client", () => {
  it("creates a client with normalized base URL", () => {
    const client = createPublishClient({
      baseUrl: "https://axis.example/",
      token: "axis_publish_token",
      fetch: async () => new Response("{}", { status: 200 }),
    });

    expect(client.baseUrl).toBe("https://axis.example");
  });

  it("creates a session, uploads artifacts, verifies uploads, and finalizes", async () => {
    const calls: Array<{ url: string; method: string; body?: unknown; headers: Record<string, string> }> = [];
    const uploadBodies: unknown[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const method = init?.method ?? "GET";
      const headers = Object.fromEntries(new Headers(init?.headers).entries());
      calls.push({ url: String(url), method, body: init?.body, headers });

      if (String(url) === "https://uploads.example/upl_1") {
        uploadBodies.push(init?.body);
        return new Response("", { status: 200 });
      }
      if (String(url).endsWith("/api/publish-sessions") && method === "POST") {
        return Response.json({
          id: "pub_1",
          repositoryName: "debian-internal",
          ecosystem: "apt",
          status: "pending_uploads",
          requestedBy: {
            tokenId: "tok_1",
            name: "ci",
            permissions: ["publish"],
            repositories: ["debian-internal"],
            ecosystemScopes: {},
            signingKeyIds: [],
          },
          artifacts: [],
          uploads: [
            {
              uploadId: "upl_1",
              filename: "pkg.deb",
              objectKey: "_staging/uploads/pub_1/upl_1/pkg.deb",
              method: "PUT",
              url: "https://uploads.example/upl_1",
              headers: { "content-type": "application/vnd.debian.binary-package" },
              expiresAt: "2026-07-23T00:10:00.000Z",
            },
          ],
          verifiedUploads: [],
          createdAt: "2026-07-23T00:00:00.000Z",
          expiresAt: "2026-07-23T00:10:00.000Z",
        });
      }
      if (String(url).endsWith("/api/publish-sessions/pub_1/uploads/upl_1/verify") && method === "POST") {
        return Response.json({
          session: { id: "pub_1", status: "ready" },
          verified: {
            uploadId: "upl_1",
            objectKey: "_staging/uploads/pub_1/upl_1/pkg.deb",
            size: 3,
            sha256: "abc",
            verifiedAt: "2026-07-23T00:01:00.000Z",
          },
        });
      }
      if (String(url).endsWith("/api/publish-sessions/pub_1/finalize") && method === "POST") {
        return Response.json({
          session: {
            id: "pub_1",
            status: "finalized",
            publishResult: {
              publishedAt: "2026-07-23T00:02:00.000Z",
              objects: [{ key: "repositories/debian/dists/noble/Release", contentType: "text/plain" }],
            },
          },
        });
      }
      return new Response("not found", { status: 404 });
    };
    const client = createPublishClient({
      baseUrl: "https://axis.example",
      token: "axis_publish_secret",
      fetch: fetchImpl,
    });

    const result = await client.publishArtifacts({
      repository: "debian-internal",
      ecosystem: "apt",
      artifacts: [
        {
          filename: "pkg.deb",
          contentType: "application/vnd.debian.binary-package",
          size: 3,
          sha256: "abc",
          body: new Blob([new Uint8Array([1, 2, 3])]),
          metadata: { package: "pkg" },
        },
      ],
    });

    expect(result.session.status).toBe("finalized");
    expect(uploadBodies).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: "https://axis.example/api/publish-sessions",
      method: "POST",
      headers: { authorization: "Bearer axis_publish_secret" },
    });
    expect(JSON.parse(String(calls[0]?.body))).toMatchObject({
      repositoryName: "debian-internal",
      ecosystem: "apt",
      artifacts: [{ filename: "pkg.deb" }],
    });
  });
});
