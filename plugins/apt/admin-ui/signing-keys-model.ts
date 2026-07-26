import type { DestructiveActionDialogContent, SigningKey } from "@axis-repository/admin-ui/plugin-ui";

export type AptSigningKeyCreateMode = "generate" | "import";

export interface SubmitAptSigningKeyFormInput {
  mode: AptSigningKeyCreateMode;
  repositoryName: string;
  formData: FormData;
  formElement: { reset(): void };
  generateKey(input: {
    repositoryName: string;
    input: {
      name: string;
      userIdName: string;
      userIdEmail: string;
    };
  }): Promise<SigningKey>;
  importKey(input: {
    repositoryName: string;
    input: {
      name: string;
      privateKeyArmored: string;
      passphrase: string;
    };
  }): Promise<SigningKey>;
  useAsPrimary?: boolean;
  setPrimarySigningKey?(key: SigningKey): Promise<void>;
  setError(message: string): void;
  close?(): void;
}

export interface AptSigningKeySettingsState {
  activeKeys: SigningKey[];
  currentKey: SigningKey | undefined;
  currentKeyRevoked: boolean;
  hasActiveKey: boolean;
  selectableSigningKeyId: string;
}

/**
 * FormData entries are `string | File`. Stringifying a File would silently
 * submit "[object File]" as a signing key name or passphrase, so read only
 * genuine text values.
 */
function formText(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

export async function submitAptSigningKeyForm(input: SubmitAptSigningKeyFormInput): Promise<void> {
  try {
    let key: SigningKey;
    if (input.mode === "generate") {
      key = await input.generateKey({
        repositoryName: input.repositoryName,
        input: {
          name: formText(input.formData, "name"),
          userIdName: formText(input.formData, "userIdName"),
          userIdEmail: formText(input.formData, "userIdEmail"),
        },
      });
    } else {
      key = await input.importKey({
        repositoryName: input.repositoryName,
        input: {
          name: formText(input.formData, "name"),
          privateKeyArmored: formText(input.formData, "privateKeyArmored"),
          passphrase: formText(input.formData, "passphrase"),
        },
      });
    }
    if (input.useAsPrimary) {
      await input.setPrimarySigningKey?.(key);
    }
    input.setError("");
    input.formElement.reset();
    input.close?.();
  } catch (caught) {
    input.setError(caught instanceof Error ? caught.message : "Signing key could not be saved");
  }
}

export function aptSigningKeySettingsState(input: {
  signingKeys: SigningKey[];
  currentSigningKeyId: string | undefined;
}): AptSigningKeySettingsState {
  const activeKeys = input.signingKeys.filter((key) => !key.revokedAt);
  const currentKey = input.signingKeys.find((key) => key.id === input.currentSigningKeyId);
  const currentKeyRevoked = Boolean(currentKey?.revokedAt);
  return {
    activeKeys,
    currentKey,
    currentKeyRevoked,
    hasActiveKey: activeKeys.length > 0,
    selectableSigningKeyId: currentKey && !currentKey.revokedAt ? currentKey.id : "",
  };
}

export function revokeAptSigningKeyDialogContent(input: {
  signingKeyName: string;
  isCurrent: boolean;
  isLastActive: boolean;
}): DestructiveActionDialogContent {
  const warnings = [
    ...(input.isCurrent
      ? ["This key is currently used by this repository. Revoking it will disable publishing until another active signing key is selected."]
      : []),
    ...(input.isLastActive
      ? ["This is the last active signing key. Revoking it will leave the repository without a usable signing key."]
      : []),
  ];
  return {
    title: "Revoke APT signing key",
    description: [
      `Revoke ${input.signingKeyName}? Repositories using this key will no longer be able to publish signed metadata with it.`,
      ...warnings,
    ].join("\n\n"),
    confirmLabel: "Revoke key",
    pendingLabel: "Revoking...",
    confirmationText: input.signingKeyName,
  };
}
