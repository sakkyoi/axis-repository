import { useState } from "react";
import { AlertTriangle, Check, Copy } from "lucide-react";
import { ErrorState } from "../../pages/shared";
import { Button } from "./button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./dialog";
import { Input } from "./input";
import {
  destructiveConfirmationCopyLabel,
  destructiveConfirmationLayoutClasses,
  destructiveConfirmationMatches,
} from "./destructive-action-dialog-model";
import type { DestructiveActionDialogContent } from "./destructive-action-dialog-model";

export interface DestructiveActionDialogProps extends DestructiveActionDialogContent {
  open: boolean;
  pending?: boolean;
  error?: unknown;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function DestructiveActionDialog({
  open,
  title,
  description,
  confirmLabel,
  pendingLabel = confirmLabel,
  confirmationText,
  pending = false,
  error,
  onOpenChange,
  onConfirm,
}: DestructiveActionDialogProps) {
  const [confirmationInput, setConfirmationInput] = useState("");
  const [copied, setCopied] = useState(false);
  const confirmed = destructiveConfirmationMatches(confirmationInput, confirmationText);
  const confirmationLayout = destructiveConfirmationLayoutClasses();

  function changeOpen(nextOpen: boolean) {
    if (pending && !nextOpen) return;
    if (!nextOpen) {
      setConfirmationInput("");
      setCopied(false);
    }
    onOpenChange(nextOpen);
  }

  async function copyConfirmationText() {
    if (!confirmationText) return;
    await navigator.clipboard.writeText(confirmationText);
    setCopied(true);
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="w-[min(92vw,440px)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {confirmationText && (
          <label className="grid gap-2">
            <span className="text-sm font-medium">Type this text to confirm.</span>
            <span className={confirmationLayout.row}>
              <code className={confirmationLayout.code}>{confirmationText}</code>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className={confirmationLayout.copyButton}
                aria-label={destructiveConfirmationCopyLabel(confirmationText)}
                title={destructiveConfirmationCopyLabel(confirmationText)}
                disabled={pending}
                onClick={() => void copyConfirmationText()}
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </span>
            <Input
              value={confirmationInput}
              disabled={pending}
              autoComplete="off"
              onChange={(event) => setConfirmationInput(event.target.value)}
            />
          </label>
        )}
        {error !== undefined && error !== null && <ErrorState title="Action failed" error={error} />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={pending} onClick={() => changeOpen(false)}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" disabled={pending || !confirmed} onClick={onConfirm}>
            {pending ? pendingLabel : confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
