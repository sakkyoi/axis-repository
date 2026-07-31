// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { ProtectedRoute } from "./ProtectedRoute";
import type { AuthContextValue } from "../auth";
import { AuthTestProvider } from "../auth-test-support";
import { ADMIN_UI_PATHS } from "../navigation";

function renderAt(path: string, auth: Partial<AuthContextValue>) {
  return render(
    <AuthTestProvider value={auth}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/ui/tokens" element={<div>Tokens page</div>} />
          </Route>
          <Route path={ADMIN_UI_PATHS.login} element={<div>Login page</div>} />
        </Routes>
      </MemoryRouter>
    </AuthTestProvider>,
  );
}

describe("ProtectedRoute", () => {
  afterEach(cleanup);

  it("waits rather than redirecting while the session is still bootstrapping", () => {
    // Redirecting here would bounce an already-signed-in user to the login
    // page on every page load, before the refresh cookie has been exchanged.
    renderAt("/ui/tokens", { isInitializing: true, isAuthenticated: false });

    // What it shows while it waits is the boot screen's business; what this
    // is about is that it has gone nowhere.
    expect(screen.getByRole("status", { name: "Starting" })).toBeDefined();
    expect(screen.queryByText("Login page")).toBeNull();
    expect(screen.queryByText("Tokens page")).toBeNull();
  });

  it("renders the protected route once authenticated", () => {
    renderAt("/ui/tokens", { isInitializing: false, isAuthenticated: true });

    expect(screen.getByText("Tokens page")).toBeDefined();
  });

  it("redirects to login when the session has resolved as signed out", () => {
    renderAt("/ui/tokens", { isInitializing: false, isAuthenticated: false });

    expect(screen.getByText("Login page")).toBeDefined();
    expect(screen.queryByText("Tokens page")).toBeNull();
  });
});
