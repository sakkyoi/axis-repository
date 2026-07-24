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
  badges: PluginLifecycleBadge[];
}

export function pluginLifecycleSummary(plugin: RepositoryPlugin): PluginLifecycleSummary {
  if (plugin.enabled === false) {
    return {
      availability: "disabled",
      label: "Disabled",
      description: "Catalog policy disables this plugin.",
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

export function repositoryPluginStatusRows(plugins: RepositoryPlugin[]): RepositoryPluginStatusRow[] {
  return plugins.map((plugin) => ({
    ecosystem: plugin.ecosystem,
    name: plugin.name,
    version: plugin.version,
    capabilities: [...plugin.capabilities],
    clientHelperSummary: clientHelperSummary(plugin),
    lifecycle: pluginLifecycleSummary(plugin),
    badges: pluginLifecycleBadges(plugin),
  }));
}
