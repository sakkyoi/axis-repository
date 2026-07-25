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
  text: string;
  copyButton: string;
} {
  return {
    prompt: "min-w-0 text-sm font-medium",
    token: "mx-1 inline-flex max-w-full align-middle",
    code: "inline-flex min-w-0 items-center rounded bg-muted px-1.5 py-0.5 font-mono text-xs",
    text: "min-w-0 truncate",
    copyButton: "ml-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-transparent p-0 text-muted-foreground hover:text-foreground disabled:opacity-50",
  };
}
