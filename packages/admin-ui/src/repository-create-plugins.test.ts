import { describe, expect, it } from "vitest";
import { getRepositoryCreatePlugin, repositoryCreatePlugins } from "./repository-create-plugins";

describe("repository create plugins", () => {
  it("exposes APT as a wizard plugin with config and dependency steps", () => {
    expect(repositoryCreatePlugins.map((plugin) => plugin.ecosystem)).toEqual(["apt"]);
    expect(getRepositoryCreatePlugin("apt")).toMatchObject({
      ecosystem: "apt",
      displayName: "APT",
      steps: ["plugin", "basics", "config", "dependencies", "review"],
    });
  });

  it("builds an APT repository create payload from wizard state", () => {
    const plugin = getRepositoryCreatePlugin("apt");

    expect(plugin.buildCreateInput({
      name: "debian-internal",
      visibility: "private",
      config: {
        codename: "noble",
        components: "main contrib",
        architectures: "amd64 arm64",
      },
      dependencies: {
        signingKeyId: "signing_key_prod",
      },
    })).toEqual({
      name: "debian-internal",
      ecosystem: "apt",
      visibility: "private",
      config: {
        apt: {
          codename: "noble",
          components: ["main", "contrib"],
          architectures: ["amd64", "arm64"],
          signingKeyId: "signing_key_prod",
        },
      },
    });
  });
});
