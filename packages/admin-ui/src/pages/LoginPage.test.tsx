// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthTestProvider } from "../auth-test-support";
import { ToastProvider } from "../components/ui/toast";
import { LoginPage } from "./LoginPage";

vi.mock("../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/client")>()),
  createAxisClient: () => ({
    loginAdmin: () => Promise.reject(new Error("nope")),
  }),
}));

function signInPage() {
  return render(
    <AuthTestProvider value={{}}>
      <MemoryRouter>
        <ToastProvider>
          <LoginPage />
        </ToastProvider>
      </MemoryRouter>
    </AuthTestProvider>,
  );
}

async function attempt(user: ReturnType<typeof userEvent.setup>, password: string) {
  const passwordBox = screen.getByLabelText("Password");
  await user.clear(passwordBox);
  await user.type(passwordBox, password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("signing in and being refused", () => {
  afterEach(cleanup);

  it("raises the refusal rather than growing the form", async () => {
    const user = userEvent.setup();
    signInPage();
    await user.type(screen.getByLabelText("Username"), "admin");

    await attempt(user, "wrong");

    expect(await screen.findByText("Sign in failed")).toBeTruthy();
    expect(screen.getByText("Username or password is invalid.")).toBeTruthy();
  });

  it("answers the second identical attempt as well as the first", async () => {
    // The same wrong password twice is two refusals. Held as state and
    // announced on change, the second attempt would be met with silence --
    // which reads as the button having done nothing at all.
    const user = userEvent.setup();
    signInPage();
    await user.type(screen.getByLabelText("Username"), "admin");

    await attempt(user, "wrong");
    await screen.findByText("Sign in failed");
    await attempt(user, "wrong");

    expect(await screen.findAllByText("Sign in failed")).toHaveLength(2);
  });

  it("asks for a username before asking the server about it", async () => {
    const user = userEvent.setup();
    signInPage();

    await attempt(user, "whatever");

    expect(await screen.findByText("Username is required.")).toBeTruthy();
  });
});
