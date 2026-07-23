import type { PluginRepositoryConfigManifest } from "@axis-repository/core/plugin-manifests";
import type { RepositoryCreateStep } from "./repository-create-plugins";

export function repositoryCreateStepsForConfig(
  repositoryConfig: PluginRepositoryConfigManifest,
): RepositoryCreateStep[] {
  const steps: RepositoryCreateStep[] = ["plugin", "basics"];
  if (repositoryConfig.fields.some((field) => field.step === "config")) steps.push("config");
  if (repositoryConfig.fields.some((field) => field.step === "dependencies")) steps.push("dependencies");
  steps.push("review");
  return steps;
}
