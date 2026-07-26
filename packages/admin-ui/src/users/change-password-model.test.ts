import { describe, expect, it } from "vitest";
import { changePasswordDialogDescription, validateChangePasswordForm } from "./change-password-model";

describe("change password model", () => {
  it("requires the current password", () => {
    expect(validateChangePasswordForm({
      currentPassword: "",
      newPassword: "changed-password",
      confirmPassword: "changed-password",
    })).toBe("Current password is required");
  });

  it("requires replacement passwords to be at least 8 characters", () => {
    expect(validateChangePasswordForm({
      currentPassword: "current-password",
      newPassword: "short",
      confirmPassword: "short",
    })).toBe("New password must be at least 8 characters");
  });

  it("requires confirmation to match the replacement password", () => {
    expect(validateChangePasswordForm({
      currentPassword: "current-password",
      newPassword: "changed-password",
      confirmPassword: "different-password",
    })).toBe("Password confirmation does not match");
  });

  it("accepts a valid password change form", () => {
    expect(validateChangePasswordForm({
      currentPassword: "current-password",
      newPassword: "changed-password",
      confirmPassword: "changed-password",
    })).toBeNull();
  });

  it("explains that the user must sign in again after changing passwords", () => {
    expect(changePasswordDialogDescription()).toContain("sign in again");
  });
});
