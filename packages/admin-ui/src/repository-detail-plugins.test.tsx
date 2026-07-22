import { describe, expect, it } from "vitest";
import { getRepositoryDetailPlugin, repositoryDetailPlugins } from "./repository-detail-plugins";

describe("repository detail plugins", () => {
  it("exposes APT as a repository detail plugin", () => {
    expect(repositoryDetailPlugins.map((plugin) => plugin.ecosystem)).toEqual(["apt"]);
    expect(getRepositoryDetailPlugin("apt")).toMatchObject({
      ecosystem: "apt",
      displayName: "APT",
    });
  });

  it("returns undefined when no detail plugin is registered for an ecosystem", () => {
    expect(getRepositoryDetailPlugin("npm")).toBeUndefined();
  });
});
