import { describe, expect, it } from "vitest";
import { createAxisClient } from "./client";
import { installInstructionsSchema, publishTokenCreateResponseSchema, repositorySchema } from "./schemas";

describe("admin API schemas", () => {
  it("parses repositories with arbitrary plugin config", () => {
    const repository = repositorySchema.parse({
      id: "repo_1",
      name: "debian-internal",
      ecosystem: "apt",
      visibility: "private",
      config: {
        apt: {
          codename: "noble",
          components: ["main"],
          architectures: ["amd64"],
          signingKeyId: "signing_key_prod",
        },
      },
      createdAt: "2026-07-22T00:00:00.000Z",
      updatedAt: "2026-07-22T00:00:00.000Z",
    });

    expect(repository.name).toBe("debian-internal");
    expect(repository.config.apt).toMatchObject({ codename: "noble" });
  });

  it("parses one-time publish token secrets only from create responses", () => {
    const response = publishTokenCreateResponseSchema.parse({
      token: {
        id: "ptok_1",
        name: "github-actions",
        permissions: ["read", "publish"],
        repositories: ["debian-internal"],
        ecosystemScopes: {},
        signingKeyIds: [],
        createdAt: "2026-07-22T00:00:00.000Z",
      },
      secret: "axis_publish_secret",
    });

    expect(response.secret).toBe("axis_publish_secret");
    expect(response.token).not.toHaveProperty("tokenHash");
  });

  it("parses APT install instructions", () => {
    const instructions = installInstructionsSchema.parse({
      repository: "debian-internal",
      visibility: "private",
      keyUrl: "https://axis.example/repositories/debian-internal/apt/key.gpg",
      keyringPath: "/usr/share/keyrings/axis-debian-internal.gpg",
      sourceListPath: "/etc/apt/sources.list.d/axis-debian-internal.list",
      sourceLine:
        "deb [signed-by=/usr/share/keyrings/axis-debian-internal.gpg] https://axis.example/repositories/debian-internal noble main",
      authConfPath: "/etc/apt/auth.conf.d/axis-debian-internal.conf",
      authConfTemplate: "machine axis.example\nlogin axis\npassword <READ_TOKEN>\n",
      commands: ["sudo apt update"],
    });

    expect(instructions.sourceLine).toContain("noble main");
    expect(instructions.authConfTemplate).toContain("<READ_TOKEN>");
  });
});

describe("createAxisClient", () => {
  it("creates an axios-backed client with normalized base URL and bearer auth", () => {
    const client = createAxisClient({
      baseUrl: "https://axis.example/",
      adminToken: "admin-secret",
    });

    expect(client.http.defaults.baseURL).toBe("https://axis.example");
    expect(client.http.defaults.headers.common.Authorization).toBe("Bearer admin-secret");
  });

  it("verifies admin tokens through the session endpoint", async () => {
    const client = createAxisClient({
      baseUrl: "https://axis.example/",
      adminToken: "admin-secret",
    });
    const requests: string[] = [];
    client.http.defaults.adapter = async (config) => {
      requests.push(`${config.method?.toUpperCase()} ${config.url}`);
      return {
        data: { ok: true },
        status: 200,
        statusText: "OK",
        headers: {},
        config,
      };
    };

    await client.verifyAdminToken();

    expect(requests).toEqual(["GET /admin/session"]);
  });
});
