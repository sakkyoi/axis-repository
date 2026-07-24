import { describe, expect, it } from "vitest";
import type { RepositoryPlugin } from "./api/schemas";
import {
  pluginLifecycleBadges,
  pluginLifecycleSummary,
  repositoryPluginStatusRows,
} from "./plugin-lifecycle";

function plugin(input: Partial<RepositoryPlugin> & Pick<RepositoryPlugin, "ecosystem">): RepositoryPlugin {
  return {
    ecosystem: input.ecosystem,
    name: input.name ?? `${input.ecosystem}-plugin`,
    version: input.version ?? "0.1.0",
    enabled: input.enabled,
    catalogEnabled: input.catalogEnabled,
    enabledOverride: input.enabledOverride,
    experimental: input.experimental,
    runtime: input.runtime,
    adminUi: input.adminUi,
    capabilities: input.capabilities ?? [],
    ...(input.clientHelpers ? { clientHelpers: input.clientHelpers } : {}),
  };
}

describe("plugin lifecycle UI model", () => {
  it("summarizes available stable plugins", () => {
    expect(pluginLifecycleSummary(plugin({
      ecosystem: "apt",
      enabled: true,
      experimental: false,
      runtime: true,
      adminUi: true,
    }))).toEqual({
      availability: "available",
      label: "Available",
      description: "Runtime and admin UI support are enabled.",
      variant: "success",
    });
  });

  it("summarizes disabled, missing runtime, and missing UI plugins", () => {
    expect(pluginLifecycleSummary(plugin({ ecosystem: "npm", enabled: false })).availability).toBe("disabled");
    expect(pluginLifecycleSummary(plugin({ ecosystem: "npm", enabled: true, runtime: false })).availability)
      .toBe("missing-runtime");
    expect(pluginLifecycleSummary(plugin({ ecosystem: "npm", enabled: true, runtime: true, adminUi: false })).availability)
      .toBe("missing-ui");
  });

  it("builds lifecycle badges for create cards and settings rows", () => {
    expect(pluginLifecycleBadges(plugin({
      ecosystem: "pypi",
      enabled: true,
      experimental: true,
      runtime: true,
      adminUi: true,
    }))).toEqual([
      { label: "Available", variant: "success" },
      { label: "Experimental", variant: "warning" },
      { label: "Runtime", variant: "default" },
      { label: "Admin UI", variant: "default" },
    ]);
  });

  it("maps repository plugin metadata to settings table rows", () => {
    const rows = repositoryPluginStatusRows([
      plugin({
        ecosystem: "apt",
        name: "apt-signed",
        version: "0.1.0",
        enabled: true,
        catalogEnabled: true,
        enabledOverride: false,
        experimental: false,
        runtime: true,
        adminUi: true,
        capabilities: ["signed-release"],
        clientHelpers: {
          namespace: "apt",
          actions: [
            { name: "install", label: "install", responseKind: "shell", defaultOpen: true, public: true },
          ],
        },
      }),
    ]);

    expect(rows).toEqual([
      {
        ecosystem: "apt",
        name: "apt-signed",
        version: "0.1.0",
        capabilities: ["signed-release"],
        clientHelperSummary: "apt: install",
        lifecycle: {
          availability: "disabled",
          label: "Disabled",
          description: "Admin policy disables this plugin.",
          variant: "destructive",
        },
        policySummary: "Override: disabled",
        policySource: "Admin override",
        policyDescription: "Effective policy is disabled by an admin override.",
        canResetPolicy: true,
        badges: [
          { label: "Disabled", variant: "destructive" },
          { label: "Runtime", variant: "default" },
          { label: "Admin UI", variant: "default" },
        ],
      },
    ]);
  });

  it("describes inherited plugin policy defaults", () => {
    const rows = repositoryPluginStatusRows([
      plugin({
        ecosystem: "pypi",
        enabled: true,
        catalogEnabled: true,
        enabledOverride: null,
      }),
    ]);

    expect(rows[0]).toMatchObject({
      policySummary: "Default: enabled",
      policySource: "Catalog default",
      policyDescription: "Effective policy follows the catalog default.",
      canResetPolicy: false,
    });
  });

  it("describes admin-enabled catalog-disabled overrides", () => {
    const rows = repositoryPluginStatusRows([
      plugin({
        ecosystem: "npm",
        enabled: true,
        catalogEnabled: false,
        enabledOverride: true,
      }),
    ]);

    expect(rows[0]).toMatchObject({
      lifecycle: {
        availability: "available",
        label: "Available",
      },
      policySummary: "Override: enabled",
      policySource: "Admin override",
      policyDescription: "Effective policy is enabled by an admin override.",
      canResetPolicy: true,
    });
  });
});
