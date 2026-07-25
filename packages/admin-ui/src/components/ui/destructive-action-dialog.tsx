import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { ErrorState } from "../../pages/shared";
import { Button } from "./button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./dialog";
import { Input } from "./input";
import { destructiveConfirmationMatches } from "./destructive-action-dialog-model";
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
  const confirmed = destructiveConfirmationMatches(confirmationInput, confirmationText);

  function changeOpen(nextOpen: boolean) {
    if (pending && !nextOpen) return;
    if (!nextOpen) {
      setConfirmationInput("");
    }
    onOpenChange(nextOpen);
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
            <span className="text-sm font-medium">
              Type <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{confirmationText}</code> to confirm.
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
