import type { BadgeProps } from "./components/ui/badge";
import type { RepositoryPlugin } from "./api/schemas";

export type PluginLifecycleAvailability = "available" | "disabled" | "missing-runtime" | "missing-ui";

export interface PluginLifecycleSummary {
  availability: PluginLifecycleAvailability;
  label: string;
  description: string;
  variant: BadgeProps["variant"];
}

export interface PluginLifecycleBadge {
  label: string;
  variant: BadgeProps["variant"];
}

export interface RepositoryPluginStatusRow {
  ecosystem: string;
  name: string;
  version: string;
  capabilities: string[];
  clientHelperSummary: string;
  lifecycle: PluginLifecycleSummary;
  policySummary: string;
  policySource: string;
  policyDescription: string;
  canResetPolicy: boolean;
  badges: PluginLifecycleBadge[];
}

export function pluginLifecycleSummary(plugin: RepositoryPlugin): PluginLifecycleSummary {
  if (plugin.enabledOverride === false || plugin.enabled === false) {
    const description = plugin.enabledOverride === false
      ? "Admin policy disables this plugin."
      : "Catalog policy disables this plugin.";
    return {
      availability: "disabled",
      label: "Disabled",
      description,
      variant: "destructive",
    };
  }
  if (plugin.runtime === false) {
    return {
      availability: "missing-runtime",
      label: "No runtime",
      description: "Catalog metadata exists, but runtime support is not wired.",
      variant: "warning",
    };
  }
  if (plugin.adminUi === false) {
    return {
      availability: "missing-ui",
      label: "No admin UI",
      description: "Runtime support is enabled, but this admin UI cannot manage it yet.",
      variant: "warning",
    };
  }
  return {
    availability: "available",
    label: "Available",
    description: "Runtime and admin UI support are enabled.",
    variant: "success",
  };
}

export function pluginLifecycleBadges(plugin: RepositoryPlugin): PluginLifecycleBadge[] {
  const summary = pluginLifecycleSummary(plugin);
  const badges: PluginLifecycleBadge[] = [{ label: summary.label, variant: summary.variant }];
  if (plugin.experimental) {
    badges.push({ label: "Experimental", variant: "warning" });
  }
  if (plugin.runtime) {
    badges.push({ label: "Runtime", variant: "default" });
  }
  if (plugin.adminUi) {
    badges.push({ label: "Admin UI", variant: "default" });
  }
  return badges;
}

function clientHelperSummary(plugin: RepositoryPlugin): string {
  if (!plugin.clientHelpers || plugin.clientHelpers.actions.length === 0) {
    return "-";
  }
  return `${plugin.clientHelpers.namespace}: ${plugin.clientHelpers.actions.map((action) => action.name).join(", ")}`;
}

function policySummary(plugin: RepositoryPlugin): string {
  if (plugin.enabledOverride === true) {
    return "Override: enabled";
  }
  if (plugin.enabledOverride === false) {
    return "Override: disabled";
  }
  return `Default: ${plugin.catalogEnabled === false ? "disabled" : "enabled"}`;
}

export function pluginPolicySource(plugin: Pick<RepositoryPlugin, "enabledOverride">): string {
  return plugin.enabledOverride === undefined || plugin.enabledOverride === null
    ? "Catalog default"
    : "Admin override";
}

export function pluginPolicyDescription(
  plugin: Pick<RepositoryPlugin, "enabled" | "enabledOverride">,
): string {
  if (plugin.enabledOverride === true) {
    return "Effective policy is enabled by an admin override.";
  }
  if (plugin.enabledOverride === false) {
    return "Effective policy is disabled by an admin override.";
  }
  return "Effective policy follows the catalog default.";
}

export function disabledPluginCreateDescription(plugin: RepositoryPlugin): string {
  return plugin.enabledOverride === false
    ? "Disabled by admin policy."
    : "Disabled by catalog default.";
}

export function repositoryPluginStatusRows(plugins: RepositoryPlugin[]): RepositoryPluginStatusRow[] {
  return plugins.map((plugin) => ({
    ecosystem: plugin.ecosystem,
    name: plugin.name,
    version: plugin.version,
    capabilities: [...plugin.capabilities],
    clientHelperSummary: clientHelperSummary(plugin),
    lifecycle: pluginLifecycleSummary(plugin),
    policySummary: policySummary(plugin),
    policySource: pluginPolicySource(plugin),
    policyDescription: pluginPolicyDescription(plugin),
    canResetPolicy: plugin.enabledOverride !== undefined && plugin.enabledOverride !== null,
    badges: pluginLifecycleBadges(plugin),
  }));
}
