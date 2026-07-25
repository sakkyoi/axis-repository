import type { PluginRepositoryConfigManifest } from "@axis-repository/core/plugin-manifests";
import type { RepositoryCreateStep } from "../plugins/repository-ui-plugin-types";

export function repositoryCreateStepsForConfig(
  repositoryConfig: PluginRepositoryConfigManifest,
): RepositoryCreateStep[] {
  const steps: RepositoryCreateStep[] = ["plugin", "basics"];
  if (repositoryConfig.fields.some((field) => field.step === "config")) steps.push("config");
  if (repositoryConfig.fields.some((field) => field.step === "setup")) steps.push("setup");
  steps.push("review");
  return steps;
}
