import { describe, expect, it } from "vitest";
import { getPypiClientInfo, listPypiProjects, setPypiFileYanked } from "./api";

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
  function recordingClient(response: unknown = { projects: [] }) {
    const calls: Array<{ path: readonly string[]; input?: unknown }> = [];
    return {
      calls,
      getRepositoryPluginResource: async (_repositoryName: string, _namespace: string, path: readonly string[]) => {
        calls.push({ path });
        return response;
      },
      postRepositoryPluginResource: async (
        _repositoryName: string,
        _namespace: string,
        path: readonly string[],
        input?: unknown,
      ) => {
        calls.push({ path, input });
        return {};
      },
    };
  }

  it("reads the published files of every project", async () => {
    const client = recordingClient({
      projects: [{
        name: "alpha",
        files: [{ filename: "alpha-1.0.tar.gz", sha256: "a".repeat(64), yanked: "broken" }],
      }],
    });

    const projects = await listPypiProjects(client, "python-internal");

    expect(projects[0]?.files[0]).toMatchObject({ filename: "alpha-1.0.tar.gz", yanked: "broken" });
    expect(client.calls[0]?.path).toEqual(["projects"]);
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
});
