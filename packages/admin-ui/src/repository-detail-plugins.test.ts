import { describe, expect, it } from "vitest";
import {
  genericRepositoryDetailSections,
  getRepositoryDetailPlugin,
  pypiInstallCommandText,
  pypiSimpleIndexUrl,
  repositoryClientHelperDisplayText,
  repositoryDetailPlugins,
} from "./repository-detail-plugins";

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

  it("lets the APT UI plugin provide the publish section renderer", () => {
    const publishSection = getRepositoryDetailPlugin("apt")?.sections.find((section) => section.id === "publish-sessions");

    expect(publishSection?.Component.name).toBe("AptPublishSessionsSection");
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
