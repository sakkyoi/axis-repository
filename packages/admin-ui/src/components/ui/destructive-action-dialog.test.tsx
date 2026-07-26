import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DestructiveActionDialog } from "./destructive-action-dialog";

const content = {
  title: "Delete repository",
  description: "Delete debian-internal? This removes every stored object.",
  confirmLabel: "Delete repository",
  pendingLabel: "Deleting...",
  confirmationText: "debian-internal",
};

function confirmButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: content.confirmLabel });
}

describe("DestructiveActionDialog", () => {
  afterEach(cleanup);

  it("keeps the destructive action disabled until the confirmation text matches exactly", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <DestructiveActionDialog {...content} open onOpenChange={() => undefined} onConfirm={onConfirm} />,
    );

    expect(confirmButton().disabled).toBe(true);

    const input = screen.getByRole("textbox");
    await user.type(input, "debian");
    expect(confirmButton().disabled).toBe(true);

    await user.type(input, "-internal");
    expect(confirmButton().disabled).toBe(false);

    await user.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("does not accept a case-mismatched confirmation", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <DestructiveActionDialog {...content} open onOpenChange={() => undefined} onConfirm={onConfirm} />,
    );

    await user.type(screen.getByRole("textbox"), "DEBIAN-INTERNAL");

    expect(confirmButton().disabled).toBe(true);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("refuses to close while the action is in flight", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <DestructiveActionDialog
        {...content}
        open
        pending
        onOpenChange={onOpenChange}
        onConfirm={() => undefined}
      />,
    );

    // Dismissing mid-delete would hide an operation that is still running.
    await user.keyboard("{Escape}");

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: content.pendingLabel })).toBeDefined();
  });

  it("confirms immediately when no confirmation text is required", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const { confirmationText, ...withoutConfirmation } = content;
    render(
      <DestructiveActionDialog
        {...withoutConfirmation}
        open
        onOpenChange={() => undefined}
        onConfirm={onConfirm}
      />,
    );

    expect(confirmButton().disabled).toBe(false);
    await user.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
