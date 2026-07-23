import type { PluginRepositoryConfigFieldManifest, PluginRepositoryConfigManifest } from "@axis-repository/core/plugin-manifests";
import type { RepositoryCreateStep } from "./repository-create-plugins";

export function repositoryConfigFieldsForStep(
  repositoryConfig: PluginRepositoryConfigManifest,
  step: RepositoryCreateStep,
): PluginRepositoryConfigFieldManifest[] {
  return repositoryConfig.fields.filter((field) => field.step === step);
}
