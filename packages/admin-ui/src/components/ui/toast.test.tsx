import { StrictMode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { ToastProvider, useErrorToast, useToast } from "./toast";

function Failing({ title, error }: { title: string; error: unknown }) {
  useErrorToast(title, error);
  return <p>content</p>;
}

function Confirming() {
  const toast = useToast();
  return <button type="button" onClick={() => toast.notify({ title: "Saved" })}>save</button>;
}

describe("messages", () => {
  afterEach(cleanup);

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
});
