import { describe, expect, it } from "vitest";
import { aptPluginManifest } from "@axis-repository/plugin-apt/manifest";
import { pypiPluginManifest } from "@axis-repository/plugin-pypi/manifest";

import {
  assertRepositoryUiPluginContracts,
  getPublishTokenScopeExtension,
  getRepositoryCreateFieldRenderers,
  getHostedRepositoryCreatePlugin,
  getRepositoryCreateServerErrorMapper,
  getHostedRepositoryDetailPlugin,
  getRepositoryPluginManifest,
  getHostedRepositoryPublishPlugin,
  getRepositoryDetailPlugin,
  getRepositoryPublishPlugin,
  hostedRepositoryCreatePluginsFromUiRegistry,
  hostedRepositoryDetailPluginsFromUiRegistry,
  hostedRepositoryUiPlugins,
  repositoryUiPluginDescriptors,
  repositoryCreatePluginOptionsFromUiRegistry,
} from "./repository-ui-plugins";

describe("repository UI plugin registry", () => {
  it("registers each ecosystem once with both create and detail UI support", () => {
    expect(hostedRepositoryUiPlugins.map((plugin) => plugin.manifest.ecosystem)).toEqual(["apt", "pypi"]);
    expect(hostedRepositoryUiPlugins.map((plugin) => plugin.kind)).toEqual(["hosted", "hosted"]);
    expect(hostedRepositoryUiPlugins.map((plugin) => [plugin.create.ecosystem, plugin.detail.ecosystem])).toEqual([
      ["apt", "apt"],
      ["pypi", "pypi"],
    ]);
  });

  it("keeps UI plugin extensions aligned with their shared manifests", () => {
    expect(() => assertRepositoryUiPluginContracts(repositoryUiPluginDescriptors)).not.toThrow();
  });

  it("keeps UI plugin ecosystems aligned with shared core manifests", () => {
    expect(hostedRepositoryUiPlugins.map((plugin) => plugin.manifest.ecosystem)).toEqual([
      aptPluginManifest.ecosystem,
      pypiPluginManifest.ecosystem,
    ]);
  });

  it("derives UI plugin metadata from the shared core manifest", () => {
    const apt = getRepositoryPluginManifest("apt");

    expect(apt).toMatchObject({
      ecosystem: "apt",
      displayName: "APT",
      description: "Debian package repositories with signed Release metadata.",
    });
  });

  it("provides create and detail registry views from the same UI plugin entries", () => {
    expect(hostedRepositoryCreatePluginsFromUiRegistry()).toEqual(hostedRepositoryUiPlugins.map((plugin) => plugin.create));
    expect(hostedRepositoryDetailPluginsFromUiRegistry()).toEqual(hostedRepositoryUiPlugins.map((plugin) => plugin.detail));
  });

  it("returns undefined for ecosystems without local UI support", () => {
    expect(getRepositoryPluginManifest("npm")).toBeUndefined();
    expect(getHostedRepositoryCreatePlugin("npm")).toBeUndefined();
    expect(getHostedRepositoryDetailPlugin("npm")).toBeUndefined();
    expect(getHostedRepositoryPublishPlugin("npm")).toBeUndefined();
    expect(getPublishTokenScopeExtension("npm")).toBeUndefined();
  });

  it("builds create plugin options from the UI plugin registry", () => {
    const options = repositoryCreatePluginOptionsFromUiRegistry([
      {
        ecosystem: "apt",
        name: "apt-signed",
        version: "0.1.0",
        enabled: true,
        experimental: false,
        runtime: true,
        adminUi: true,
        capabilities: ["signed-release"],
        repositoryKinds: ["hosted"],
      },
      {
        ecosystem: "npm",
        name: "npm-registry",
        version: "0.1.0",
        enabled: false,
        catalogEnabled: true,
        enabledOverride: false,
        experimental: true,
        runtime: true,
        adminUi: false,
        capabilities: ["package-index"],
        repositoryKinds: ["hosted"],
      },
    ]);

    expect(options.map((option) => [option.ecosystem, option.supported])).toEqual([
      ["apt", true],
      ["npm", false],
    ]);
    expect(options[0]).toMatchObject({
      ecosystem: "apt",
      kind: "hosted",
      displayName: "APT",
      supported: true,
      lifecycle: { availability: "available", label: "Available" },
      badges: [
        { label: "Available", variant: "success" },
        { label: "Runtime", variant: "default" },
        { label: "Admin UI", variant: "default" },
      ],
    });
    expect(options[1]).toMatchObject({
      ecosystem: "npm",
      supported: false,
      description: "Disabled by admin policy.",
      disabledReason: "Effective policy is disabled by an admin override.",
      lifecycle: { availability: "disabled", label: "Disabled" },
      badges: [
        { label: "Disabled", variant: "destructive" },
        { label: "Experimental", variant: "warning" },
        { label: "Runtime", variant: "default" },
      ],
    });
  });

  it("dispatches repository UI plugins by repository kind and ecosystem", () => {
    expect(getRepositoryDetailPlugin({
      ecosystem: "apt",
      kind: "hosted",
    })?.ecosystem).toBe("apt");
    expect(getRepositoryPublishPlugin({
      ecosystem: "apt",
      kind: "hosted",
    })?.PreviewComponent).toBeTypeOf("function");
    expect(getRepositoryDetailPlugin({
      ecosystem: "apt",
      kind: "proxy",
    })?.ecosystem).toBe("apt");
    expect(getRepositoryDetailPlugin({
      ecosystem: "apt",
      kind: "group",
    })?.ecosystem).toBe("apt");
    expect(getRepositoryPublishPlugin({
      ecosystem: "apt",
      kind: "proxy",
    })).toBeUndefined();
    expect(getRepositoryPublishPlugin({
      ecosystem: "apt",
      kind: "group",
    })).toBeUndefined();
  });

  it("offers create adapters for every repository kind supported by a plugin", () => {
    const options = repositoryCreatePluginOptionsFromUiRegistry([
      {
        ecosystem: "apt",
        name: "apt-signed",
        version: "0.1.0",
        enabled: true,
        experimental: false,
        runtime: true,
        adminUi: true,
        capabilities: ["signed-release"],
        repositoryKinds: ["hosted", "proxy", "group"],
      },
    ]);

    expect(options.map((option) => ({
      ecosystem: option.ecosystem,
      kind: option.kind,
      supported: option.supported,
    }))).toEqual([
      { ecosystem: "apt", kind: "hosted", supported: true },
      { ecosystem: "apt", kind: "proxy", supported: true },
      { ecosystem: "apt", kind: "group", supported: true },
    ]);
  });

  it("reports when no create adapter is registered for the plugin repository kinds", () => {
    const options = repositoryCreatePluginOptionsFromUiRegistry([
      {
        ecosystem: "npm",
        name: "npm-proxy",
        version: "0.1.0",
        enabled: true,
        experimental: false,
        runtime: true,
        adminUi: true,
        capabilities: ["signed-release"],
        repositoryKinds: ["proxy"],
      },
    ]);

    expect(options).toMatchObject([{
      ecosystem: "npm",
      displayName: "npm",
      description: "No admin UI create adapter is registered for this plugin's repository kinds yet.",
      capabilities: ["signed-release"],
      lifecycle: { availability: "available", label: "Available" },
      badges: [
        { label: "Available", variant: "success" },
        { label: "Runtime", variant: "default" },
        { label: "Admin UI", variant: "default" },
      ],
      supported: false,
    }]);
  });

  it("lets ecosystem UI plugins map create errors for their own config and setup", () => {
    expect(getRepositoryCreateServerErrorMapper("apt")?.("Signing key is required")).toBe("setup");
    expect(getRepositoryCreateServerErrorMapper("apt")?.("config.apt.codename is required")).toBe("config");
    expect(getRepositoryCreateServerErrorMapper("pypi")?.("Signing key is required")).toBeUndefined();
  });

  it("lets ecosystem UI plugins provide custom create field renderers", () => {
    expect(getRepositoryCreateFieldRenderers("apt")?.["signing-key"]).toBeUndefined();
    expect(getRepositoryCreateFieldRenderers("apt")?.["signing-key-provisioning"]).toBeTypeOf("function");
    expect(getRepositoryCreateFieldRenderers("pypi")?.["signing-key-provisioning"]).toBeUndefined();
  });

  it("lets ecosystem UI plugins provide publish token scope derivation", () => {
    expect(getPublishTokenScopeExtension("apt")?.deriveSigningKeyIds({
      repositories: [{
        id: "repo_apt",
        name: "debian-internal",
        ecosystem: "apt",
        kind: "hosted",
        visibility: "private",
        config: { apt: { signingKeyId: "signing_key_prod" } },
        createdAt: "2026-07-23T00:00:00.000Z",
        updatedAt: "2026-07-23T00:00:00.000Z",
      }],
      selectedRepositories: ["debian-internal"],
      permissions: { read: false, publish: true },
    })).toEqual(["signing_key_prod"]);
    expect(getPublishTokenScopeExtension("pypi")).toBeUndefined();
  });

  it("lets ecosystem UI plugins provide publish UI and artifact summaries", () => {
    expect(getHostedRepositoryPublishPlugin("apt")?.PreviewComponent).toBeTypeOf("function");
    expect(getHostedRepositoryPublishPlugin("apt")?.accept).toContain(".deb");
    expect(getHostedRepositoryPublishPlugin("apt")?.isAcceptedFile?.(new File(["deb"], "myapp.deb"))).toBe(true);
    expect(getHostedRepositoryPublishPlugin("apt")?.isAcceptedFile?.(new File(["wheel"], "myapp.whl"))).toBe(false);
    expect(getHostedRepositoryPublishPlugin("apt")?.SessionDetailComponent).toBeTypeOf("function");
    // Without a preview component the workspace offers no way to publish at
    // all, which is what PyPI repositories had: uploading meant twine or the
    // session API, and nothing in the admin UI.
    expect(getHostedRepositoryPublishPlugin("pypi")?.PreviewComponent).toBeTypeOf("function");
    expect(getHostedRepositoryPublishPlugin("pypi")?.accept).toContain(".whl");
    expect(getHostedRepositoryPublishPlugin("pypi")?.isAcceptedFile?.(new File(["whl"], "my_project-1.0-py3-none-any.whl"))).toBe(true);
    expect(getHostedRepositoryPublishPlugin("pypi")?.isAcceptedFile?.(new File(["deb"], "myapp.deb"))).toBe(false);
    expect(getHostedRepositoryPublishPlugin("pypi")?.SessionDetailComponent).toBeTypeOf("function");
    expect(getHostedRepositoryPublishPlugin("pypi")?.PreviewComponent)
      .not.toBe(getHostedRepositoryPublishPlugin("apt")?.PreviewComponent);
    // Distinct plugins must not resolve to the same component.
    expect(getHostedRepositoryPublishPlugin("pypi")?.SessionDetailComponent)
      .not.toBe(getHostedRepositoryPublishPlugin("apt")?.SessionDetailComponent);
    expect(getHostedRepositoryPublishPlugin("apt")?.artifactSummary({
      id: "pub_apt",
      repositoryName: "debian-internal",
      ecosystem: "apt",
      status: "finalized",
      requestedBy: {
        tokenId: "tok_1",
        name: "ci",
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

  it("lets ecosystem UI plugins validate missing publish token scopes", () => {
    expect(getPublishTokenScopeExtension("apt")?.missingRequiredScopes({
      repositories: [
        {
          id: "repo_apt",
          name: "debian-internal",
          ecosystem: "apt",
          kind: "hosted",
          visibility: "private",
          config: {},
          createdAt: "2026-07-23T00:00:00.000Z",
          updatedAt: "2026-07-23T00:00:00.000Z",
        },
        {
          id: "repo_pypi",
          name: "python-internal",
          ecosystem: "pypi",
          kind: "hosted",
          visibility: "private",
          config: {},
          createdAt: "2026-07-23T00:00:00.000Z",
          updatedAt: "2026-07-23T00:00:00.000Z",
        },
      ],
      selectedRepositories: ["debian-internal", "python-internal"],
      permissions: { read: false, publish: true },
    })).toEqual(["debian-internal"]);
  });
});
