import { describe, expect, it } from "vitest";
import {
  genericRepositoryDetailSections,
  getRepositoryDetailPlugin,
  repositorySettingsSectionsFor,
  repositorySummarySectionsFor,
  repositoryWorkspaceSectionsFor,
  repositoryClientHelperDisplayText,
  repositoryDetailPlugins,
} from "./repository-detail-plugins";
import { pypiInstallCommandText, pypiSimpleIndexUrl } from "../../../../../plugins/pypi/admin-ui/detail";

describe("repository detail plugins", () => {
  it("exposes APT as a repository detail plugin", () => {
    expect(repositoryDetailPlugins.map((plugin) => plugin.ecosystem)).toEqual(["apt", "pypi"]);
    expect(getRepositoryDetailPlugin("apt")).toMatchObject({
      ecosystem: "apt",
    });
    expect(getRepositoryDetailPlugin("pypi")).toMatchObject({
      ecosystem: "pypi",
    });
  });

  it("returns undefined when no detail plugin is registered for an ecosystem", () => {
    expect(getRepositoryDetailPlugin("npm")).toBeUndefined();
  });

  it("exposes ordered detail sections per ecosystem", () => {
    expect(getRepositoryDetailPlugin("apt")?.sections.map((section) => section.id)).toEqual([
      "settings",
      "publish-sessions",
      "advanced-json",
      "signing-keys",
      "client-helpers",
    ]);
    expect(getRepositoryDetailPlugin("pypi")?.sections.map((section) => section.id)).toEqual([
      "settings",
      "publish-sessions",
      "client-helpers",
      "install-hints",
    ]);
  });

  it("uses the shared publish section while plugins provide publish pieces", () => {
    const aptPublishSection = getRepositoryDetailPlugin("apt")?.sections.find((section) => section.id === "publish-sessions");
    const pypiPublishSection = getRepositoryDetailPlugin("pypi")?.sections.find((section) => section.id === "publish-sessions");

    expect(aptPublishSection?.Component.name).toBe("RepositoryPublishSection");
    expect(pypiPublishSection?.Component.name).toBe("RepositoryPublishSection");
  });

  it("renders plugin client helpers through the same shared section", () => {
    const aptClientHelpers = getRepositoryDetailPlugin("apt")?.sections.find((section) => section.id === "client-helpers");
    const pypiClientHelpers = getRepositoryDetailPlugin("pypi")?.sections.find((section) => section.id === "client-helpers");

    expect(aptClientHelpers?.Component).toBe(pypiClientHelpers?.Component);
    expect(aptClientHelpers?.Component.name).toBe("RepositoryClientHelpersSection");
  });

  it("provides generic fallback sections for unknown ecosystems", () => {
    expect(genericRepositoryDetailSections.map((section) => section.id)).toEqual([
      "settings",
      "publish-sessions",
      "advanced-json",
    ]);
  });

  it("splits repository workspace sections from settings sections", () => {
    expect(repositoryWorkspaceSectionsFor("apt").map((section) => section.id)).toEqual([
      "publish-sessions",
      "client-helpers",
    ]);
    expect(repositorySettingsSectionsFor("apt").map((section) => section.id)).toEqual([
      "settings",
      "advanced-json",
      "signing-keys",
    ]);
    expect(repositoryWorkspaceSectionsFor("pypi").map((section) => section.id)).toEqual([
      "publish-sessions",
      "client-helpers",
      "install-hints",
    ]);
    expect(repositorySettingsSectionsFor("pypi").map((section) => section.id)).toEqual([
      "settings",
    ]);
  });

  it("lets plugins choose sections for the readonly repository summary", () => {
    expect(repositorySummarySectionsFor("apt").map((section) => section.id)).toEqual(["client-helpers"]);
    expect(repositorySummarySectionsFor("pypi").map((section) => section.id)).toEqual(["install-hints"]);
    expect(repositorySummarySectionsFor("unknown").map((section) => section.id)).toEqual([]);
  });

  it("builds PyPI client setup text from a repository", () => {
    const repository = {
      id: "repo_1",
      name: "python-internal",
      ecosystem: "pypi",
      visibility: "private" as const,
      config: {},
      createdAt: "2026-07-18T00:00:00.000Z",
      updatedAt: "2026-07-18T00:00:00.000Z",
    };

    expect(pypiSimpleIndexUrl(repository)).toBe("/repositories/python-internal/simple/");
    expect(pypiInstallCommandText(repository, "https://axis.example/repositories/python-internal/simple/")).toBe([
      "# Use a read token for private repositories.",
      "export AXIS_PYPI_TOKEN=\"<READ_TOKEN>\"",
      "",
      "# Install packages from this repository.",
      "pip install \\",
      "  --index-url \"https://axis:${AXIS_PYPI_TOKEN}@axis.example/repositories/python-internal/simple/\" \\",
      "  <package>",
    ].join("\n"));
  });

  it("formats generic repository client helper responses by metadata kind", () => {
    expect(repositoryClientHelperDisplayText({ responseKind: "shell" }, { script: "sudo apt update" }))
      .toBe("sudo apt update");
    expect(repositoryClientHelperDisplayText({ responseKind: "json" }, { simpleUrl: "https://axis.example/simple/" }))
      .toBe("{\n  \"simpleUrl\": \"https://axis.example/simple/\"\n}");
    expect(repositoryClientHelperDisplayText({ responseKind: "text" }, "plain text"))
      .toBe("plain text");
  });

  it("formats a selected client helper response field when the plugin provides a display path", () => {
    expect(repositoryClientHelperDisplayText(
      { responseKind: "text", displayPath: "simpleUrl" },
      { simpleUrl: "https://axis.example/repositories/python/simple/" },
    )).toBe("https://axis.example/repositories/python/simple/");
  });
});
