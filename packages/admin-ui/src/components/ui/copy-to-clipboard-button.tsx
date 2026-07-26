import { Check, Copy } from "lucide-react";
import { Button, type ButtonProps } from "./button";
import { useClipboardCopyFeedback } from "./use-clipboard-copy-feedback";

export interface CopyToClipboardButtonProps extends Omit<ButtonProps, "onClick" | "children"> {
  text: string;
  label?: string;
  copiedLabel?: string;
  onCopied?: () => void;
}

export function CopyToClipboardButton({
  text,
  label = "Copy",
  copiedLabel = label,
  disabled,
  onCopied,
  ...props
}: CopyToClipboardButtonProps) {
  const { copied, copyText } = useClipboardCopyFeedback();

  async function copy() {
    await copyText(text);
    onCopied?.();
  }

  return (
    <Button
      {...props}
      disabled={disabled}
      onClick={() => void copy()}
    >
      {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
      {copied ? copiedLabel : label}
    </Button>
  );
}
