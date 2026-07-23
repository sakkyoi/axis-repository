import type { CreatePublishTokenInput } from "./api/client";
import type { PublishToken, Repository } from "./api/schemas";

export interface PublishTokenPermissionState {
  read: boolean;
  publish: boolean;
}

export interface BuildCreatePublishTokenInputState {
  name: string;
  selectedRepositories: string[];
  permissions: PublishTokenPermissionState;
  signingKeySelections: Record<string, string>;
}

export function buildCreatePublishTokenInput(state: BuildCreatePublishTokenInputState): CreatePublishTokenInput {
  const permissions = [
    ...(state.permissions.read ? ["read"] : []),
    ...(state.permissions.publish ? ["publish"] : []),
  ];
  const signingKeyIds = state.permissions.publish
    ? [...new Set(Object.values(state.signingKeySelections).filter(Boolean))]
    : [];

  return {
    name: state.name.trim(),
    repositories: [...state.selectedRepositories],
    permissions,
    ecosystemScopes: {},
    ...(signingKeyIds.length > 0 ? { signingKeyIds } : {}),
  };
}

export function repositoryDisplayLabel(repository: Repository): string {
  return `${repository.name} (${repository.ecosystem})`;
}

export function tokenScopeSummary(token: Pick<PublishToken, "repositories" | "permissions" | "signingKeyIds">): {
  repositories: string;
  permissions: string;
  signingKeys: string;
} {
  return {
    repositories: token.repositories.length ? token.repositories.join(", ") : "none",
    permissions: token.permissions.length ? token.permissions.join(", ") : "none",
    signingKeys: token.signingKeyIds.length ? token.signingKeyIds.join(", ") : "none",
  };
}
