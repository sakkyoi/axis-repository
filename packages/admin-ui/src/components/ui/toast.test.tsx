// @vitest-environment happy-dom

import { StrictMode, useEffect } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dialog, DialogContent, DialogTitle } from "./dialog";
import { ToastProvider, useErrorToast, useToast } from "./toast";
import { toastSubdueAfterMs } from "./toast-model";

function Failing({ title, error }: { title: string; error: unknown }) {
  useErrorToast(title, error);
  return <p>content</p>;
}

function Pointing() {
  const toast = useToast();
  return (
    <button
      type="button"
      onClick={() => toast.notify({
        title: "Something to deal with",
        tone: "warning",
        action: { label: "Deal with it", to: { pathname: "/ui/settings", hash: "#credentials" } },
      })}
    >
      warn
    </button>
  );
}

function Confirming() {
  const toast = useToast();
  return <button type="button" onClick={() => toast.notify({ title: "Saved" })}>save</button>;
}

function Announcing() {
  const toast = useToast();
  useEffect(() => {
    toast.notify({ title: "Upload failed", tone: "error" });
  }, [toast]);
  return null;
}

function Warning() {
  const toast = useToast();
  return <button type="button" onClick={() => toast.notify({ title: "Review needed", tone: "warning" })}>warn</button>;
}

describe("messages", () => {
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("raises a failure in the corner", async () => {
    render(
      <ToastProvider>
        <Failing title="Publish failed" error={new Error("The upload was refused as too large")} />
      </ToastProvider>,
    );

    expect(await screen.findByText("Publish failed")).toBeTruthy();
    expect(screen.getByText("The upload was refused as too large")).toBeTruthy();
  });

  it("says one failure once, however many times the effect runs", async () => {
    // StrictMode runs an effect twice on purpose, and a query re-renders for
    // reasons of its own. Announcing on each pass would bury the corner in
    // copies of one problem.
    render(
      <StrictMode>
        <ToastProvider>
          <Failing title="Request failed" error={new Error("Repositories unavailable")} />
        </ToastProvider>
      </StrictMode>,
    );
    await screen.findByText("Request failed");

    expect(screen.getAllByText("Request failed")).toHaveLength(1);
  });

  it("says the next failure when it is a different one", async () => {
    const view = render(
      <ToastProvider>
        <Failing title="Request failed" error={new Error("first")} />
      </ToastProvider>,
    );
    await screen.findByText("first");

    view.rerender(
      <ToastProvider>
        <Failing title="Request failed" error={new Error("second")} />
      </ToastProvider>,
    );

    expect(await screen.findByText("second")).toBeTruthy();
    expect(screen.getByText("first")).toBeTruthy();
  });

  it("keeps a failure until someone closes it", async () => {
    render(
      <ToastProvider>
        <Failing title="Publish failed" error="something went wrong" />
      </ToastProvider>,
    );
    await screen.findByText("Publish failed");

    await userEvent.click(screen.getByRole("button", { name: "Dismiss Publish failed" }));

    expect(screen.queryByText("Publish failed")).toBeNull();
  });

  it("says nothing while there is no failure", () => {
    render(
      <ToastProvider>
        <Failing title="Publish failed" error={undefined} />
      </ToastProvider>,
    );

    expect(screen.queryByText("Publish failed")).toBeNull();
  });

  it("stays quiet where nothing is listening", () => {
    // Rendered on its own, without a provider, which a test should not have to
    // arrange for just to render a component that might fail.
    expect(() => render(<Failing title="Publish failed" error={new Error("boom")} />)).not.toThrow();
  });

  it("takes a confirmation too, which does not wait to be dismissed", async () => {
    render(
      <ToastProvider>
        <Confirming />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "save" }));

    expect(await screen.findByText("Saved")).toBeTruthy();
  });

  it("enters with a reduced-motion-safe animation", async () => {
    render(
      <ToastProvider>
        <Confirming />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "save" }));
    const toast = (await screen.findByText("Saved")).closest("[data-toast-state]");

    expect(toast?.className).toContain("motion-safe:animate-toast-enter");
  });

  it("sits above the highest dialog layer so it can still be dismissed", () => {
    render(
      <ToastProvider>
        <p>content</p>
      </ToastProvider>,
    );

    const zIndexClass = screen.getByRole("status").className
      .split(" ")
      .find((className) => className.startsWith("z-["));

    expect(Number(zIndexClass?.match(/^z-\[(\d+)\]$/)?.[1])).toBeGreaterThan(70);
  });

  it("can be dismissed while a modal drawer is open", async () => {
    const changeOpen = vi.fn();
    render(
      <ToastProvider>
        <Dialog open onOpenChange={changeOpen}>
          <DialogContent>
            <DialogTitle>Publish artifact</DialogTitle>
          </DialogContent>
        </Dialog>
        <Announcing />
      </ToastProvider>,
    );
    await screen.findByText("Upload failed");

    await userEvent.click(screen.getByRole("button", { name: "Dismiss Upload failed" }));

    expect(screen.queryByText("Upload failed")).toBeNull();
    expect(changeOpen).not.toHaveBeenCalled();
  });

  it("dims a persistent message after a short delay without removing it", async () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Warning />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "warn" }));
    const message = screen.getByText("Review needed");
    const toast = message.closest("[data-toast-state]");

    expect(toast?.className).not.toContain("opacity-50");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(toastSubdueAfterMs("warning") ?? 0);
    });

    expect(screen.getByText("Review needed")).toBeTruthy();
    expect(toast?.className).toContain("opacity-50");
    expect(toast?.className).toContain("focus-within:opacity-100");
  });

  it("waits before dimming again after hover ends", async () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Warning />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "warn" }));
    const toast = screen.getByText("Review needed").closest("[data-toast-state]");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(toastSubdueAfterMs("warning") ?? 0);
    });
    expect(toast?.className).toContain("opacity-50");

    fireEvent.pointerEnter(toast!);
    expect(toast?.className).not.toContain("opacity-50");
    expect(toast?.className).not.toContain("transition-opacity");

    fireEvent.pointerLeave(toast!);
    await act(async () => {
      await vi.advanceTimersByTimeAsync((toastSubdueAfterMs("warning") ?? 0) - 1);
    });
    expect(toast?.className).not.toContain("opacity-50");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(toast?.className).toContain("opacity-50");
  });
});

describe("a message that has somewhere to be dealt with", () => {
  afterEach(cleanup);

  async function raise() {
    render(
      <MemoryRouter>
        <ToastProvider>
          <Pointing />
        </ToastProvider>
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("button", { name: "warn" }));
    return screen.findByRole("link", { name: "Deal with it" });
  }

  it("offers the way there as a link, not as the name of a page", async () => {
    // Told where to go and left to find it, the reader navigates by hand --
    // and a corner holding two sentences is the worst place to give directions.
    const link = await raise();

    expect(link.getAttribute("href")).toBe("/ui/settings#credentials");
  });

  it("goes away once it has been followed", async () => {
    // The page it leads to says the same thing at length. Left up, the message
    // sits over an account of itself.
    const link = await raise();

    await userEvent.click(link);

    expect(screen.queryByText("Something to deal with")).toBeNull();
  });
});
