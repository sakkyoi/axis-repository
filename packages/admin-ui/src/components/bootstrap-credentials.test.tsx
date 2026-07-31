// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthTestProvider } from "../auth-test-support";
import { useDeployment } from "../api/hooks";
import { ADMIN_UI_PATHS } from "../navigation";
import { BOOTSTRAP_CREDENTIALS_ANCHOR } from "./bootstrap-credentials";
import { BootstrapCredentialsBanner, BootstrapCredentialsCard } from "./bootstrap-credentials";

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
          {node}
          <Loaded />
        </MemoryRouter>
      </QueryClientProvider>
    </AuthTestProvider>,
  );
  await screen.findByText("loaded");
  return view;
}

describe("the banner about credentials nobody removed", () => {
  afterEach(cleanup);

  it("interrupts every page while a password is still set", async () => {
    await show(<BootstrapCredentialsBanner />, [password, username]);

    expect(screen.getByText(/AXIS_ADMIN_PASSWORD is still set/)).toBeTruthy();
  });

  it("stays out of the way when only the username is left over", async () => {
    // Nothing is exposed by it, and a banner nobody needs is one they learn to
    // read past.
    await show(<BootstrapCredentialsBanner />, [username]);

    expect(screen.queryByText(/still set/)).toBeNull();
  });

  it("says nothing on a deployment that was cleaned up", async () => {
    await show(<BootstrapCredentialsBanner />, []);

    expect(screen.queryByText(/still set/)).toBeNull();
  });

  it("offers the way to the part of the page that explains it", async () => {
    // The admin UI is served under /ui, so a bare /settings leaves the
    // application entirely -- and landing on Settings without the anchor
    // leaves the reader to find the card that was being talked about.
    await show(<BootstrapCredentialsBanner />, [password]);

    expect(screen.getByRole("link", { name: "How to remove it" }).getAttribute("href"))
      .toBe(`${ADMIN_UI_PATHS.settings}#${BOOTSTRAP_CREDENTIALS_ANCHOR}`);
  });
});

describe("the settings card about the same thing", () => {
  afterEach(cleanup);

  it("lists the username too, which the banner deliberately omits", async () => {
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
