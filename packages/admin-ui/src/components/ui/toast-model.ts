/**
 * How a message reads, and how long it is worth keeping.
 *
 * Confirmations say a thing worked and are gone before they are in the way.
 * Failures carry the only account of what went wrong -- often a sentence or
 * two of it -- and a message that takes itself away while it is still being
 * read is worse than none, so those wait to be dismissed.
 */
export type ToastTone = "info" | "error";

export function toastAutoDismissMs(): number {
  return 3000;
}

/** Undefined where the message stays until someone closes it. */
export function toastDismissAfterMs(tone: ToastTone): number | undefined {
  return tone === "error" ? undefined : toastAutoDismissMs();
}

/**
 * What to say about a thrown value.
 *
 * Everything shown to anyone passes through here, so a value that is not an
 * error still reads as a sentence rather than as `[object Object]`.
 */
export function toastErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unexpected error";
}
