import { PluginPolicyService, ValidationError } from "@axis-repository/core";

export interface RepositoryPluginPolicyFields {
  catalogEnabled: boolean;
  enabledOverride: boolean | null;
  enabled: boolean;
}

export async function repositoryPluginPolicyFields(input: {
  pluginPolicyService: PluginPolicyService;
  ecosystem: string;
  catalogEnabled: boolean;
}): Promise<RepositoryPluginPolicyFields> {
  const policy = await input.pluginPolicyService.get(input.ecosystem);
  const enabledOverride = policy?.enabledOverride ?? null;
  return {
    catalogEnabled: input.catalogEnabled,
    enabledOverride,
    enabled: enabledOverride ?? input.catalogEnabled,
  };
}

export async function ensureRepositoryPluginEnabled(input: {
  pluginPolicyService: PluginPolicyService;
  ecosystem: string;
  catalogEnabled: boolean;
  errorFactory?: () => Error;
}): Promise<void> {
  const policy = await repositoryPluginPolicyFields(input);
  if (!policy.enabled) {
    throw (input.errorFactory ?? (() => new ValidationError(`Repository plugin is disabled: ${input.ecosystem}`)))();
  }
}
