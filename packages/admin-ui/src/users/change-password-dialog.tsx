import { type FormEvent, useState } from "react";
import { KeyRound } from "lucide-react";
import { useChangeOwnPassword } from "../api/hooks";
import { useAuth } from "../auth";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { useErrorToast } from "../components/ui/toast";
import { ErrorState } from "../pages/shared";
import {
  changePasswordDialogDescription,
  validateChangePasswordForm,
  type ChangePasswordFormState,
} from "./change-password-model";

export function ChangePasswordDialog() {
  const auth = useAuth();
  const changePassword = useChangeOwnPassword();
  useErrorToast("Password not changed", changePassword.error);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ChangePasswordFormState>({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [validationError, setValidationError] = useState("");

  function updateField(field: keyof ChangePasswordFormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setValidationError("");
  }

  function resetDialog() {
    setForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    setValidationError("");
    changePassword.reset();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const error = validateChangePasswordForm(form);
    if (error) {
      setValidationError(error);
      return;
    }
    await changePassword.mutateAsync({
      currentPassword: form.currentPassword,
      newPassword: form.newPassword.trim(),
    });
    setOpen(false);
    resetDialog();
    auth.logout();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (changePassword.isPending) return;
        setOpen(nextOpen);
        if (!nextOpen) {
          resetDialog();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          <KeyRound className="mr-2 h-4 w-4" />
          Change password
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>{changePasswordDialogDescription()}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={submit}>
          <label className="grid gap-2">
            <span className="text-sm font-medium">Current password</span>
            <Input
              type="password"
              autoComplete="current-password"
              value={form.currentPassword}
              onChange={(event) => updateField("currentPassword", event.target.value)}
            />
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-medium">New password</span>
            <Input
              type="password"
              autoComplete="new-password"
              value={form.newPassword}
              onChange={(event) => updateField("newPassword", event.target.value)}
            />
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-medium">Confirm new password</span>
            <Input
              type="password"
              autoComplete="new-password"
              value={form.confirmPassword}
              onChange={(event) => updateField("confirmPassword", event.target.value)}
            />
          </label>
          {Boolean(validationError) && <ErrorState error={validationError} />}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={changePassword.isPending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={changePassword.isPending}>
              {changePassword.isPending ? "Changing..." : "Change password"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
