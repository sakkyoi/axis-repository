import type { PublishTokenScopeInput } from "@axis-repository/admin-ui/plugin-ui";

export function aptPublishTokenSigningKeyIds(input: PublishTokenScopeInput): string[] {
  if (!input.permissions.publish) return [];
  return selectedAptRepositories(input)
    .map((repository) => aptSigningKeyId(repository.config))
    .filter((signingKeyId): signingKeyId is string => Boolean(signingKeyId));
}

export function aptPublishTokenMissingRequiredScopes(input: PublishTokenScopeInput): string[] {
  if (!input.permissions.publish) return [];
  return selectedAptRepositories(input)
    .filter((repository) => !aptSigningKeyId(repository.config))
    .map((repository) => repository.name);
}

function selectedAptRepositories(input: PublishTokenScopeInput) {
  const selected = new Set(input.selectedRepositories);
  return input.repositories.filter((repository) =>
    selected.has(repository.name) && repository.ecosystem === "apt",
  );
}

function aptSigningKeyId(config: Record<string, unknown>): string | undefined {
  const aptConfig = config.apt;
  if (!aptConfig || typeof aptConfig !== "object") return undefined;
  const signingKeyId = (aptConfig as { signingKeyId?: unknown }).signingKeyId;
  return typeof signingKeyId === "string" && signingKeyId.trim() ? signingKeyId : undefined;
}
