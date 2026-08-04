import { describe, expect, it } from "vitest";
import {
  genericRepositoryDetailSections,
  getHostedRepositoryDetailPlugin,
  repositorySettingsSectionsFor,
  repositorySummarySectionsFor,
  repositoryWorkspaceSectionsFor,
  repositoryClientHelperDisplayText,
  hostedRepositoryDetailPlugins,
} from "./repository-detail-plugins";
import type { Repository } from "../../api/schemas";
import { pypiInstallCommandText, pypiSimpleIndexUrl } from "@axis-repository/plugin-pypi/admin-ui/detail";

function repository(input: Partial<Repository> = {}): Repository {
  return {
    id: "repo_1",
    name: "debian-internal",
    ecosystem: "apt",
    kind: "hosted",
    visibility: "private",
    config: {},
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
    ...input,
  };
}

describe("repository detail plugins", () => {
  it("exposes APT as a repository detail plugin", () => {
    expect(hostedRepositoryDetailPlugins.map((plugin) => plugin.ecosystem)).toEqual(["apt", "pypi"]);
    expect(getHostedRepositoryDetailPlugin("apt")).toMatchObject({
      ecosystem: "apt",
    });
    expect(getHostedRepositoryDetailPlugin("pypi")).toMatchObject({
      ecosystem: "pypi",
    });
  });

  it("returns undefined when no detail plugin is registered for an ecosystem", () => {
    expect(getHostedRepositoryDetailPlugin("npm")).toBeUndefined();
  });

  it("exposes ordered detail sections per ecosystem", () => {
    expect(getHostedRepositoryDetailPlugin("apt")?.sections.map((section) => section.id)).toEqual([
      "repository-artifacts",
      "repository-browser",
      "settings",
      "advanced-json",
      "signing-keys",
      "client-helpers",
    ]);
    expect(getHostedRepositoryDetailPlugin("pypi")?.sections.map((section) => section.id)).toEqual([
      "repository-artifacts",
      "repository-browser",
      "settings",
      "client-helpers",
      "install-hints",
      "project-files",
    ]);
  });

  it("uses the shared repository browser while plugins provide publish pieces", () => {
    const aptBrowserSection = getHostedRepositoryDetailPlugin("apt")?.sections.find((section) => section.id === "repository-browser");
    const pypiBrowserSection = getHostedRepositoryDetailPlugin("pypi")?.sections.find((section) => section.id === "repository-browser");

    expect(aptBrowserSection?.Component.name).toBe("RepositoryBrowserSection");
    expect(pypiBrowserSection?.Component.name).toBe("RepositoryBrowserSection");
  });

  it("renders plugin client helpers through the same shared section", () => {
    const aptClientHelpers = getHostedRepositoryDetailPlugin("apt")?.sections.find((section) => section.id === "client-helpers");
    const pypiClientHelpers = getHostedRepositoryDetailPlugin("pypi")?.sections.find((section) => section.id === "client-helpers");

    expect(aptClientHelpers?.Component).toBe(pypiClientHelpers?.Component);
    expect(aptClientHelpers?.Component.name).toBe("RepositoryClientHelpersSection");
  });

  it("provides generic fallback sections for unknown ecosystems", () => {
    expect(genericRepositoryDetailSections.map((section) => section.id)).toEqual([
      "settings",
      "repository-artifacts",
      "repository-browser",
      "advanced-json",
    ]);
  });

  it("splits repository workspace sections from settings sections", () => {
    expect(repositoryWorkspaceSectionsFor(repository({ ecosystem: "apt" })).map((section) => section.id)).toEqual([
      "repository-artifacts",
      "repository-browser",
      "client-helpers",
    ]);
    expect(repositorySettingsSectionsFor(repository({ ecosystem: "apt" })).map((section) => section.id)).toEqual([
      "settings",
      "advanced-json",
      "signing-keys",
    ]);
    expect(repositoryWorkspaceSectionsFor(repository({ ecosystem: "pypi" })).map((section) => section.id)).toEqual([
      "repository-artifacts",
      "repository-browser",
      "client-helpers",
      "install-hints",
      "project-files",
    ]);
    expect(repositorySettingsSectionsFor(repository({ ecosystem: "pypi" })).map((section) => section.id)).toEqual([
      "settings",
    ]);
  });

  it("lets plugins choose sections for the readonly repository summary", () => {
    expect(repositorySummarySectionsFor(repository({ ecosystem: "apt" })).map((section) => section.id)).toEqual(["client-helpers"]);
    expect(repositorySummarySectionsFor(repository({ ecosystem: "pypi" })).map((section) => section.id)).toEqual(["install-hints"]);
    expect(repositorySummarySectionsFor(repository({ ecosystem: "unknown" })).map((section) => section.id)).toEqual([]);
  });

  it("does not apply hosted detail sections to non-hosted repositories", () => {
    expect(repositoryWorkspaceSectionsFor(repository({ kind: "proxy" })).map((section) => section.id)).toEqual([]);
    expect(repositorySettingsSectionsFor(repository({ kind: "group" })).map((section) => section.id)).toEqual([]);
    expect(repositorySummarySectionsFor(repository({ kind: "proxy" })).map((section) => section.id)).toEqual([]);
  });

  it("builds PyPI client setup text from a repository", () => {
    const repository = {
      id: "repo_1",
      name: "python-internal",
      ecosystem: "pypi",
      kind: "hosted" as const,
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
