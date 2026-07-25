import type { CreatePublishTokenInput } from "../api/client";
import type { PublishToken, Repository } from "../api/schemas";
import type { DestructiveActionDialogContent } from "../components/ui/destructive-action-dialog-model";

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

export function initialPublishTokenSelection(_tokens: PublishToken[]): string | undefined {
  return undefined;
}

export function publishTokenRowStateClass(tokenName: string, selectedName: string | undefined): string {
  return tokenName === selectedName
    ? "border-l-4 border-l-primary bg-primary/10 hover:bg-primary/15"
    : "border-l-4 border-l-transparent hover:bg-muted/60";
}

export function publishTokenDetailBodyClass(): string {
  return "grid h-full min-h-0 content-start gap-4 overflow-y-auto overflow-x-hidden p-4";
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

export function publishTokenSummaryItems(token: PublishToken): Array<[string, string]> {
  const summary = tokenScopeSummary(token);
  return [
    ["Permissions", summary.permissions],
    ["Repositories", summary.repositories],
    ["Signing key scopes", summary.signingKeys],
    ["Created", token.createdAt],
    ["Expires", token.expiresAt ?? "never"],
  ];
}

export function revokePublishTokenDialogContent(tokenName: string): DestructiveActionDialogContent {
  return {
    title: "Revoke publish token",
    description: `Revoke ${tokenName}? Existing automation using this token will stop working.`,
    confirmLabel: "Revoke token",
    pendingLabel: "Revoking...",
    confirmationText: tokenName,
  };
}
