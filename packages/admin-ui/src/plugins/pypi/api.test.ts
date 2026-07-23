import { describe, expect, it } from "vitest";
import { getPypiClientInfo } from "./api";

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
