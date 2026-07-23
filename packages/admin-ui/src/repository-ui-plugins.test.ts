import { describe, expect, it } from "vitest";
import { aptPluginManifest, pypiPluginManifest } from "@axis-repository/core/plugin-manifests";

import {
  getRepositoryUiPlugin,
  repositoryCreatePluginOptionsFromUiRegistry,
  repositoryCreatePluginsFromUiRegistry,
  repositoryDetailPluginsFromUiRegistry,
  repositoryUiPlugins,
} from "./repository-ui-plugins";

describe("repository UI plugin registry", () => {
  it("registers each ecosystem once with both create and detail UI support", () => {
    expect(repositoryUiPlugins.map((plugin) => plugin.manifest.ecosystem)).toEqual(["apt", "pypi"]);
    expect(repositoryUiPlugins.map((plugin) => [plugin.create.ecosystem, plugin.detail.ecosystem])).toEqual([
      ["apt", "apt"],
      ["pypi", "pypi"],
    ]);
  });

  it("keeps UI plugin ecosystems aligned with shared core manifests", () => {
    expect(repositoryUiPlugins.map((plugin) => plugin.manifest.ecosystem)).toEqual([
      aptPluginManifest.ecosystem,
      pypiPluginManifest.ecosystem,
    ]);
  });

  it("derives UI plugin metadata from the shared core manifest", () => {
    const apt = getRepositoryUiPlugin("apt");

    expect(apt?.manifest).toMatchObject({
      ecosystem: "apt",
      displayName: "APT",
      description: "Debian package repositories with signed Release metadata.",
    });
    expect("displayName" in apt!).toBe(false);
    expect("displayName" in apt!.create).toBe(false);
    expect("description" in apt!.create).toBe(false);
    expect("capabilities" in apt!.create).toBe(false);
    expect("displayName" in apt!.detail).toBe(false);
  });

  it("provides create and detail registry views from the same UI plugin entries", () => {
    expect(repositoryCreatePluginsFromUiRegistry()).toEqual(repositoryUiPlugins.map((plugin) => plugin.create));
    expect(repositoryDetailPluginsFromUiRegistry()).toEqual(repositoryUiPlugins.map((plugin) => plugin.detail));
  });

  it("returns undefined for ecosystems without local UI support", () => {
    expect(getRepositoryUiPlugin("npm")).toBeUndefined();
  });

  it("builds create plugin options from the UI plugin registry", () => {
    const options = repositoryCreatePluginOptionsFromUiRegistry([
      {
        ecosystem: "apt",
        name: "apt-signed",
        version: "0.1.0",
        capabilities: ["signed-release"],
      },
      {
        ecosystem: "npm",
        name: "npm-registry",
        version: "0.1.0",
        capabilities: ["package-index"],
      },
    ]);

    expect(options.map((option) => [option.ecosystem, option.supported])).toEqual([
      ["apt", true],
      ["npm", false],
    ]);
    expect(options[0]).toMatchObject({
      ecosystem: "apt",
      displayName: "APT",
      supported: true,
    });
  });

  it("lets ecosystem UI plugins map create errors for their own config and dependencies", () => {
    expect(getRepositoryUiPlugin("apt")?.mapCreateServerError?.("Signing key is required")).toBe("dependencies");
    expect(getRepositoryUiPlugin("apt")?.mapCreateServerError?.("config.apt.codename is required")).toBe("config");
    expect(getRepositoryUiPlugin("pypi")?.mapCreateServerError?.("Signing key is required")).toBeUndefined();
  });

  it("lets ecosystem UI plugins provide custom create field renderers", () => {
    expect(getRepositoryUiPlugin("apt")?.createFieldRenderers?.["signing-key"]?.name)
      .toBe("AptSigningKeyDependencyField");
    expect(getRepositoryUiPlugin("pypi")?.createFieldRenderers?.["signing-key"]).toBeUndefined();
  });

  it("lets ecosystem UI plugins provide publish token scope UI", () => {
    expect(getRepositoryUiPlugin("apt")?.publishTokenScope?.Component.name)
      .toBe("AptSigningKeyTokenScopeFields");
    expect(getRepositoryUiPlugin("pypi")?.publishTokenScope).toBeUndefined();
  });

  it("lets ecosystem UI plugins provide publish UI and artifact summaries", () => {
    expect(getRepositoryUiPlugin("apt")?.publish?.Component.name).toBe("AptPublishSessionsSection");
    expect(getRepositoryUiPlugin("pypi")?.publish?.Component.name).toBe("PypiPublishSessionsSection");
    expect(getRepositoryUiPlugin("apt")?.publish?.artifactSummary({
      id: "pub_apt",
      repositoryName: "debian-internal",
      ecosystem: "apt",
      status: "finalized",
      requestedBy: {
        tokenId: "tok_1",
        name: "ci",
        permissions: ["publish"],
        repositories: ["debian-internal"],
        ecosystemScopes: {},
        signingKeyIds: [],
      },
      artifacts: [{
        filename: "myapp_1.2.3_amd64.deb",
        size: 1234,
        sha256: "a".repeat(64),
        contentType: "application/vnd.debian.binary-package",
        metadata: { package: "myapp", version: "1.2.3", architecture: "amd64" },
      }],
      uploads: [],
      verifiedUploads: [],
      createdAt: "2026-07-23T00:00:00.000Z",
      expiresAt: "2026-07-23T00:10:00.000Z",
    })).toBe("myapp 1.2.3 amd64, 0 verified");
  });

  it("lets ecosystem UI plugins validate publish token scope selections", () => {
    expect(getRepositoryUiPlugin("apt")?.publishTokenScope?.missingSelections({
      repositories: [
        {
          id: "repo_apt",
          name: "debian-internal",
          ecosystem: "apt",
          visibility: "private",
          config: {},
          createdAt: "2026-07-23T00:00:00.000Z",
          updatedAt: "2026-07-23T00:00:00.000Z",
        },
        {
          id: "repo_pypi",
          name: "python-internal",
          ecosystem: "pypi",
          visibility: "private",
          config: {},
          createdAt: "2026-07-23T00:00:00.000Z",
          updatedAt: "2026-07-23T00:00:00.000Z",
        },
      ],
      selectedRepositories: ["debian-internal", "python-internal"],
      permissions: { read: false, publish: true },
      signingKeySelections: {},
    })).toEqual(["debian-internal"]);
  });
});
