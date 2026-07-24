import type { PluginRepositoryConfigFieldManifest, PluginRepositoryConfigManifest } from "@axis-repository/core/plugin-manifests";
import type { RepositoryCreateStep } from "../plugins/repository-ui-plugin-types";

export function repositoryConfigFieldsForStep(
  repositoryConfig: PluginRepositoryConfigManifest,
  step: RepositoryCreateStep,
): PluginRepositoryConfigFieldManifest[] {
  return repositoryConfig.fields.filter((field) => field.step === step);
}
