export interface ChangePasswordFormState {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export function validateChangePasswordForm(input: ChangePasswordFormState): string | null {
  if (!input.currentPassword) {
    return "Current password is required";
  }
  if (input.newPassword.trim().length < 8) {
    return "New password must be at least 8 characters";
  }
  if (input.newPassword !== input.confirmPassword) {
    return "Password confirmation does not match";
  }
  return null;
}

export function changePasswordDialogDescription(): string {
  return "After changing your password, you will need to sign in again.";
}
