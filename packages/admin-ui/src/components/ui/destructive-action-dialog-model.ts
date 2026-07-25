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

export function destructiveConfirmationCopiedResetMs(): number {
  return 1500;
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
    code: "inline-flex min-w-0 cursor-pointer items-center rounded bg-muted px-1.5 py-0.5 font-mono text-xs hover:bg-muted/80 disabled:cursor-default disabled:opacity-50",
    text: "min-w-0 truncate",
    copyButton: "ml-1 inline-flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground",
  };
}
