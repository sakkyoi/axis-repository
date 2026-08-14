import { describe, expect, it } from "vitest";
import {
  getPypiClientInfo,
  getPypiProject,
  listPypiProjects,
  setPypiFileYanked,
} from "./api";
import { getRepositoryProxyCache, purgeRepositoryProxyCache } from "@axis-repository/admin-ui/plugin-ui";

describe("PyPI UI plugin API adapter", () => {
  it("uses generic repository client helpers for client info", async () => {
    const calls: Array<{ repositoryName: string; namespace: string; action: string }> = [];
    const client = {
      getRepositoryClientHelper: async (repositoryName: string, namespace: string, action: string) => {
        calls.push({ repositoryName, namespace, action });
        return {
          repository: "python-internal",
          ecosystem: "pypi",
          simpleUrl: "https://axis.example/repositories/python-internal/simple/",
          pipIndexUrl: "https://axis.example/repositories/python-internal/simple/",
        };
      },
    };

    await expect(getPypiClientInfo(client, "python-internal"))
      .resolves.toMatchObject({ pipIndexUrl: "https://axis.example/repositories/python-internal/simple/" });
    expect(calls).toEqual([
      { repositoryName: "python-internal", namespace: "pypi", action: "simple-url" },
    ]);
  });
});

describe("PyPI project files API adapter", () => {
  function recordingClient(
    response: unknown = { projects: [], truncated: false },
    postResponse: unknown = {},
  ) {
    const calls: Array<{
      path: readonly string[];
      input?: unknown;
      options?: { searchParams?: Record<string, string | number | undefined> };
    }> = [];
    return {
      calls,
      getRepositoryPluginResource: async (
        _repositoryName: string,
        _namespace: string,
        path: readonly string[],
        options?: { searchParams?: Record<string, string | number | undefined> },
      ) => {
        calls.push({
          path,
          ...(options === undefined ? {} : { options }),
        });
        return response;
      },
      postRepositoryPluginResource: async (
        _repositoryName: string,
        _namespace: string,
        path: readonly string[],
        input?: unknown,
      ) => {
        calls.push({ path, input });
        return postResponse;
      },
    };
  }

  it("reads project summaries", async () => {
    const client = recordingClient({
      projects: [{
        name: "alpha",
        fileCount: 1,
      }],
      truncated: false,
    });

    const projects = await listPypiProjects(client, "python-internal", { limit: 50, cursor: "next" });

    expect(projects.projects[0]).toMatchObject({ name: "alpha", fileCount: 1 });
    expect(client.calls[0]).toMatchObject({
      path: ["projects"],
      options: { searchParams: { limit: 50, cursor: "next" } },
    });
  });

  it("reads the published files of one project", async () => {
    const client = recordingClient({
      project: {
        name: "alpha",
        files: [{ filename: "alpha-1.0.tar.gz", sha256: "a".repeat(64), yanked: "broken" }],
      },
    });

    const project = await getPypiProject(client, "python-internal", "alpha");

    expect(project.files[0]).toMatchObject({ filename: "alpha-1.0.tar.gz", yanked: "broken" });
    expect(client.calls[0]).toMatchObject({ path: ["projects", "alpha"] });
  });

  it("sends a yank with its reason", async () => {
    const client = recordingClient();

    await setPypiFileYanked(client, {
      repositoryName: "python-internal",
      project: "alpha",
      filename: "alpha-1.0.tar.gz",
      reason: "broken build",
      yanked: true,
    });

    expect(client.calls[0]).toEqual({
      path: ["projects", "alpha", "files", "alpha-1.0.tar.gz", "yank"],
      input: { reason: "broken build" },
    });
  });

  it("sends a yank with no reason as an empty one", async () => {
    // PEP 592 treats a yank with no stated reason as a yank all the same, so
    // this cannot become an unyank on the way.
    const client = recordingClient();

    await setPypiFileYanked(client, {
      repositoryName: "python-internal",
      project: "alpha",
      filename: "alpha-1.0.tar.gz",
      reason: "",
      yanked: true,
    });

    expect(client.calls[0]).toMatchObject({ input: { reason: "" } });
    expect(client.calls[0]?.path.at(-1)).toBe("yank");
  });

  it("lifts a yank through the unyank route", async () => {
    const client = recordingClient();

    await setPypiFileYanked(client, {
      repositoryName: "python-internal",
      project: "alpha",
      filename: "alpha-1.0.tar.gz",
      reason: undefined,
      yanked: false,
    });

    expect(client.calls[0]).toEqual({
      path: ["projects", "alpha", "files", "alpha-1.0.tar.gz", "unyank"],
      input: undefined,
    });
  });

  it("reads and purges proxy byte cache through plugin resources", async () => {
    const client = recordingClient(
      { cache: { fileCount: 2, byteCount: 18 } },
      {
        job: {
          id: "repository.proxy-cache.purge:python-internal:pypi",
          type: "repository.proxy-cache.purge",
          status: "pending",
          subject: { type: "repository", id: "python-internal", repositoryName: "python-internal" },
          repositoryName: "python-internal",
          priority: 0,
          attempts: 0,
          requestedAt: "2026-08-05T00:00:00.000Z",
          scheduledAt: "2026-08-05T00:00:00.000Z",
          result: { namespace: "pypi" },
        },
      },
    );

    await expect(getRepositoryProxyCache(client, "python-internal", "pypi"))
      .resolves.toEqual({ fileCount: 2, byteCount: 18 });
    expect(client.calls[0]).toMatchObject({ path: ["proxy-cache"] });

    client.calls.length = 0;
    await expect(purgeRepositoryProxyCache(client, "python-internal", "pypi"))
      .resolves.toMatchObject({ job: { type: "repository.proxy-cache.purge", status: "pending" } });
    expect(client.calls[0]).toEqual({
      path: ["proxy-cache", "purge"],
      input: undefined,
    });
  });
});
