import type { CreatePublishTokenInput } from "../api/client";
import type { PublishToken, Repository } from "../api/schemas";
import type { DestructiveActionDialogContent } from "../components/ui/destructive-action-dialog-model";

export interface PublishTokenPermissionState {
  read: boolean;
  publish: boolean;
}

export type PublishTokenExpirationMode = "never" | "1h" | "1d" | "7d" | "30d" | "custom";

export interface PublishTokenExpirationState {
  mode: PublishTokenExpirationMode;
  customDateTime: string;
}

export interface BuildCreatePublishTokenInputState {
  name: string;
  selectedRepositories: string[];
  permissions: PublishTokenPermissionState;
  signingKeySelections: Record<string, string>;
  expiration?: PublishTokenExpirationState;
  now?: Date;
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
    ...(() => {
      const expiresAt = buildPublishTokenExpiresAt({
        expiration: state.expiration ?? { mode: "never", customDateTime: "" },
        now: state.now ?? new Date(),
      });
      return expiresAt ? { expiresAt } : {};
    })(),
  };
}

export function buildPublishTokenExpiresAt(input: {
  expiration: PublishTokenExpirationState;
  now: Date;
}): string | undefined {
  const ttlMsByMode: Partial<Record<PublishTokenExpirationMode, number>> = {
    "1h": 60 * 60 * 1000,
    "1d": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
  };
  if (input.expiration.mode === "never") {
    return undefined;
  }
  if (input.expiration.mode === "custom") {
    const customDateTime = input.expiration.customDateTime.trim();
    if (!customDateTime) {
      throw new Error("Custom expiration is required");
    }
    const customExpiresAt = new Date(customDateTime);
    if (!Number.isFinite(customExpiresAt.getTime())) {
      throw new Error("Custom expiration is invalid");
    }
    return customExpiresAt.toISOString();
  }
  const ttlMs = ttlMsByMode[input.expiration.mode];
  if (ttlMs === undefined) {
    throw new Error("Publish token expiration is invalid");
  }
  return new Date(input.now.getTime() + ttlMs).toISOString();
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

export function publishTokenDetailActionRowClass(): string {
  return "flex min-w-0 justify-start";
}

export function publishTokenSummaryGridClass(): string {
  return "grid min-w-0 gap-3";
}

export function publishTokenSummaryItemClass(): string {
  return "grid min-w-0 gap-1 rounded-md border border-border bg-background/40 p-3";
}

export function publishTokenSummaryValueClass(): string {
  return "min-w-0 break-words text-sm";
}

export function publishTokenRawMetadataContainerClass(): string {
  return "min-w-0";
}

export function publishTokenRawMetadataClass(): string {
  return "mt-2 max-h-80 min-w-0 overflow-auto rounded-md bg-muted p-3 text-xs";
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
