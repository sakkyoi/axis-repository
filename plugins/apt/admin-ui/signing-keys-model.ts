import type { DestructiveActionDialogContent } from "@axis-repository/admin-ui/plugin-ui";

export function revokeAptSigningKeyDialogContent(signingKeyName: string): DestructiveActionDialogContent {
  return {
    title: "Revoke APT signing key",
    description: `Revoke ${signingKeyName}? Repositories using this key will no longer be able to publish signed metadata with it.`,
    confirmLabel: "Revoke key",
    pendingLabel: "Revoking...",
    confirmationText: signingKeyName,
  };
}
