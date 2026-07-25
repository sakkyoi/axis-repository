import { useRef, useState } from "react";
import { clipboardCopiedResetMs } from "./copy-feedback-model";

export function useClipboardCopyFeedback() {
  const [copied, setCopied] = useState(false);
  const copiedResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function clearCopiedFeedback() {
    setCopied(false);
    if (copiedResetTimeoutRef.current) {
      clearTimeout(copiedResetTimeoutRef.current);
      copiedResetTimeoutRef.current = undefined;
    }
  }

  async function copyText(text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    if (copiedResetTimeoutRef.current) {
      clearTimeout(copiedResetTimeoutRef.current);
    }
    copiedResetTimeoutRef.current = setTimeout(() => {
      setCopied(false);
      copiedResetTimeoutRef.current = undefined;
    }, clipboardCopiedResetMs());
  }

  return { copied, copyText, clearCopiedFeedback };
}
