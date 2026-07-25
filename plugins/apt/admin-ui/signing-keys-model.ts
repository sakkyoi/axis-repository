import type { DestructiveActionDialogContent } from "@axis-repository/admin-ui/plugin-ui";

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
  }): Promise<unknown>;
  importKey(input: {
    repositoryName: string;
    input: {
      name: string;
      privateKeyArmored: string;
      passphrase: string;
    };
  }): Promise<unknown>;
  setError(message: string): void;
}

export async function submitAptSigningKeyForm(input: SubmitAptSigningKeyFormInput): Promise<void> {
  try {
    if (input.mode === "generate") {
      await input.generateKey({
        repositoryName: input.repositoryName,
        input: {
          name: String(input.formData.get("name") ?? ""),
          userIdName: String(input.formData.get("userIdName") ?? ""),
          userIdEmail: String(input.formData.get("userIdEmail") ?? ""),
        },
      });
    } else {
      await input.importKey({
        repositoryName: input.repositoryName,
        input: {
          name: String(input.formData.get("name") ?? ""),
          privateKeyArmored: String(input.formData.get("privateKeyArmored") ?? ""),
          passphrase: String(input.formData.get("passphrase") ?? ""),
        },
      });
    }
    input.setError("");
    input.formElement.reset();
  } catch (caught) {
    input.setError(caught instanceof Error ? caught.message : "Signing key could not be saved");
  }
}

export function revokeAptSigningKeyDialogContent(signingKeyName: string): DestructiveActionDialogContent {
  return {
    title: "Revoke APT signing key",
    description: `Revoke ${signingKeyName}? Repositories using this key will no longer be able to publish signed metadata with it.`,
    confirmLabel: "Revoke key",
    pendingLabel: "Revoking...",
    confirmationText: signingKeyName,
  };
}
