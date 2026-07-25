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
  row: string;
  prompt: string;
  code: string;
  copyButton: string;
} {
  return {
    row: "flex min-w-0 items-center gap-2",
    prompt: "min-w-0 flex-1 text-sm font-medium",
    code: "inline-block max-w-full truncate rounded bg-muted px-1.5 py-0.5 align-bottom text-xs",
    copyButton: "h-8 w-8 shrink-0",
  };
}
