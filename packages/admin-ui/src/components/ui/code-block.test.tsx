import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CodeBlock } from "./code-block";
import { ToastProvider } from "./toast";

function clipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
}

describe("a block of code", () => {
  beforeEach(() => clipboard(async () => {}));
  afterEach(cleanup);

  it("shows the code it was given", () => {
    render(<CodeBlock code="sudo tee /etc/apt/auth.conf" language="shell" />);

    expect(screen.getByText(/sudo/)).toBeTruthy();
  });

  it("copies the whole block, not the coloured pieces of it", async () => {
    // The colouring cuts the text into spans; what belongs on the clipboard is
    // the command as it was written.
    const copied: string[] = [];
    clipboard(async (text) => void copied.push(text));
    const code = "# Install\ncurl -fsSL https://example/key.gpg | sudo gpg --dearmor";
    render(<CodeBlock code={code} language="shell" />);

    await userEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(copied).toEqual([code]);
  });

  it("says so when it has copied", async () => {
    render(<CodeBlock code="echo hi" language="shell" />);

    await userEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
  });

  it("says when the clipboard refused rather than looking as though it worked", async () => {
    clipboard(async () => {
      throw new Error("Write permission denied");
    });
    render(
      <ToastProvider>
        <CodeBlock code="echo hi" language="shell" />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(await screen.findByText("Could not copy")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
  });

  it("leaves the button out where a block is not for copying", () => {
    render(<CodeBlock code="echo hi" language="shell" copyable={false} />);

    expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();
  });
});
