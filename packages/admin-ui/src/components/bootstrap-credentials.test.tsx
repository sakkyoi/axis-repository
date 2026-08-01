// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toastAutoDismissMs } from "./ui/toast-model";
import { AuthTestProvider } from "../auth-test-support";
import { useDeployment } from "../api/hooks";
import { ToastProvider } from "./ui/toast";
import {
  BOOTSTRAP_CREDENTIALS_ANCHOR,
  BootstrapCredentialsCard,
  useBootstrapCredentialsToast,
} from "./bootstrap-credentials";

const leftover: Array<{ name: string; sensitive: boolean; removal: string }> = [];

vi.mock("../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/client")>()),
  createAxisClient: () => ({
    getDeployment: async () => ({ leftoverBootstrapCredentials: leftover }),
  }),
}));

const password = {
  name: "AXIS_ADMIN_PASSWORD",
  sensitive: true,
  removal: "Deleted from the Worker's Settings > Variables and Secrets.",
  command: "wrangler secret delete AXIS_ADMIN_PASSWORD",
};
const username = {
  name: "AXIS_ADMIN_USERNAME",
  sensitive: false,
  removal: "Declared as a plain variable, so it is removed from `vars` in wrangler.jsonc.",
  command: ["# Remove it from wrangler.jsonc, then", "wrangler deploy"].join("\n"),
};

/**
 * Reports when the answer has arrived.
 *
 * Every one of these components draws nothing while the request is in flight,
 * so "it is not on the page" is true a tick after rendering whatever the
 * answer turns out to be. Without something to wait for, a test that asserts
 * an absence asserts only that React is not synchronous.
 */
function Loaded() {
  return <span>{useDeployment().isSuccess ? "loaded" : "loading"}</span>;
}

async function show(node: React.ReactNode, reported: typeof leftover) {
  leftover.splice(0, leftover.length, ...reported);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <AuthTestProvider value={{ accessToken: "token" }}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ToastProvider>
            {node}
            <Loaded />
          </ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </AuthTestProvider>,
  );
  await screen.findByText("loaded");
  return view;
}

/** Nothing of its own; the warning it raises is what there is to look at. */
function Warned() {
  useBootstrapCredentialsToast();
  return null;
}

describe("the warning about credentials nobody removed", () => {
  afterEach(cleanup);

  it("is raised while a password is still set", async () => {
    await show(<Warned />, [password, username]);

    expect(await screen.findByText(/AXIS_ADMIN_PASSWORD is still set/)).toBeTruthy();
  });

  it("leads to the card that says how, not to the top of Settings", async () => {
    // A warning with nowhere to act on it is one the reader closes. Settings
    // holds several cards, and the one this is about is not the first.
    await show(<Warned />, [password]);

    const link = await screen.findByRole("link", { name: "How to remove it" });
    expect(link.getAttribute("href")).toBe(`/ui/settings#${BOOTSTRAP_CREDENTIALS_ANCHOR}`);
  });

  it("stays quiet when only the username is left over", async () => {
    // Nothing is exposed by it, and a warning nobody needs is one they learn
    // to close without reading.
    await show(<Warned />, [username]);

    expect(screen.queryByText(/still set/)).toBeNull();
  });

  it("says nothing on a deployment that was cleaned up", async () => {
    await show(<Warned />, []);

    expect(screen.queryByText(/still set/)).toBeNull();
  });

  it("waits to be dismissed rather than expiring while it is read", async () => {
    // It describes something to go and do. Taken away on a timer, it is a
    // warning that only reaches whoever happened to be looking.
    await show(<Warned />, [password]);
    const raised = await screen.findByText(/AXIS_ADMIN_PASSWORD is still set/);

    await new Promise((resolve) => setTimeout(resolve, toastAutoDismissMs() + 100));

    expect(raised.isConnected).toBe(true);
  });
});

describe("the settings card about the same thing", () => {
  afterEach(cleanup);

  it("lists the username too, which the warning deliberately omits", async () => {
    await show(<BootstrapCredentialsCard />, [password, username]);

    expect(screen.getByText("AXIS_ADMIN_USERNAME")).toBeTruthy();
    expect(screen.getByText("AXIS_ADMIN_PASSWORD")).toBeTruthy();
  });

  it("sends each one to the place it is actually declared", async () => {
    // A secret and a plain variable are removed in different places, and the
    // wrong instruction sends an operator somewhere the value is not.
    const card = await show(<BootstrapCredentialsCard />, [password, username]);

    expect(card.container.textContent).toContain("Variables and Secrets");
    expect(card.container.textContent).toContain("wrangler.jsonc");
  });

  it("gives every row something to run, not only the sensitive ones", async () => {
    // A username that can only be removed by reading a paragraph and working
    // out what it meant is one that stays where it is.
    //
    // Read as text rather than looked up as an element: a highlighted block is
    // cut into a span per token, so no single node holds the command.
    const card = await show(<BootstrapCredentialsCard />, [password, username]);

    expect(card.container.textContent).toContain("wrangler secret delete AXIS_ADMIN_PASSWORD");
    expect(card.container.textContent).toContain("wrangler deploy");
  });

  it("shows nothing at all where there is nothing to remove", async () => {
    await show(<BootstrapCredentialsCard />, []);

    expect(screen.queryByText("Bootstrap credentials")).toBeNull();
  });
});
