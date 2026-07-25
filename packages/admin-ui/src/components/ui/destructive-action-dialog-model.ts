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
  code: string;
  copyButton: string;
} {
  return {
    row: "grid min-w-0 grid-cols-[minmax(0,1fr)_2rem] items-center gap-2",
    code: "min-w-0 truncate rounded bg-muted px-2 py-1 text-xs",
    copyButton: "h-8 w-8 shrink-0",
  };
}
