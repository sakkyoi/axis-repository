export interface DestructiveActionDialogContent {
  title: string;
  description: string;
  confirmLabel: string;
  pendingLabel: string;
  confirmationText?: string | undefined;
}

export function destructiveConfirmationMatches(input: string, confirmationText: string | undefined): boolean {
  if (!confirmationText) {
    return true;
  }
  return input.trim() === confirmationText;
}

export function destructiveConfirmationCopyLabel(confirmationText: string): string {
  return `Copy ${confirmationText}`;
}

export function destructiveConfirmationLayoutClasses(): {
  prompt: string;
  token: string;
  code: string;
  copyButton: string;
} {
  return {
    prompt: "min-w-0 text-sm font-medium",
    token: "mx-1 inline-flex max-w-full align-middle",
    code: "min-w-0 truncate rounded-l bg-muted px-1.5 py-0.5 font-mono text-xs",
    copyButton: "h-6 w-6 shrink-0 rounded-l-none border-l-0 px-0",
  };
}
