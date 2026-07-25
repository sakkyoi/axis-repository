import { AlertTriangle } from "lucide-react";
import { ErrorState } from "../../pages/shared";
import { Button } from "./button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./dialog";

export interface DestructiveActionDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  pendingLabel?: string;
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
  pending = false,
  error,
  onOpenChange,
  onConfirm,
}: DestructiveActionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (pending && !nextOpen) return;
      onOpenChange(nextOpen);
    }}>
      <DialogContent className="w-[min(92vw,440px)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {error !== undefined && error !== null && <ErrorState title="Action failed" error={error} />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" disabled={pending} onClick={onConfirm}>
            {pending ? pendingLabel : confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
