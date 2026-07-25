import { Check, Copy } from "lucide-react";
import { Button, type ButtonProps } from "./button";
import { useClipboardCopyFeedback } from "./use-clipboard-copy-feedback";

export interface CopyToClipboardButtonProps extends Omit<ButtonProps, "onClick" | "children"> {
  text: string;
  label?: string;
  copiedLabel?: string;
}

export function CopyToClipboardButton({
  text,
  label = "Copy",
  copiedLabel = label,
  disabled,
  ...props
}: CopyToClipboardButtonProps) {
  const { copied, copyText } = useClipboardCopyFeedback();

  return (
    <Button
      {...props}
      disabled={disabled}
      onClick={() => void copyText(text)}
    >
      {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
      {copied ? copiedLabel : label}
    </Button>
  );
}
