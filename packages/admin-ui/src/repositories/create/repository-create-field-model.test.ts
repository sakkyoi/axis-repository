import { aptPluginManifest } from "@axis-repository/plugin-apt/manifest";
import { pypiPluginManifest } from "@axis-repository/plugin-pypi/manifest";
import { describe, expect, it } from "vitest";
import { repositoryConfigFieldsForStep } from "./repository-create-field-model";

describe("repository create field model", () => {
  it("selects manifest fields for the requested wizard step", () => {
    expect(repositoryConfigFieldsForStep(aptPluginManifest.repositoryConfig, "config").map((field) => field.name))
      .toEqual(["codename"]);
    expect(repositoryConfigFieldsForStep(aptPluginManifest.repositoryConfig, "setup").map((field) => field.name))
      .toEqual(["signingKey"]);
  });

  it("returns no fields for plugins without config fields", () => {
    expect(repositoryConfigFieldsForStep(pypiPluginManifest.repositoryConfig, "config")).toEqual([]);
    expect(repositoryConfigFieldsForStep(pypiPluginManifest.repositoryConfig, "setup")).toEqual([]);
  });
});
