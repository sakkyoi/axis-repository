// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProfileMenu } from "./profile-menu";

vi.mock("../api/hooks", () => ({
  useAdminSession: () => ({
    data: {
      principal: {
        username: "admin",
      },
    },
  }),
}));

vi.mock("../auth", () => ({
  useAuth: () => ({
    accessToken: "token",
    logout: vi.fn(),
  }),
}));

describe("ProfileMenu", () => {
  afterEach(cleanup);

  it("opens on focus and closes when focus leaves the menu", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ProfileMenu />
        <button type="button">Outside</button>
      </MemoryRouter>,
    );

    await user.tab();

    expect(screen.getByRole("menuitem", { name: "Profile settings" })).toBeTruthy();

    await user.tab();
    await user.tab();
    await user.tab();

    await waitFor(() => expect(screen.queryByRole("menuitem", { name: "Profile settings" })).toBeNull());
  });
});
