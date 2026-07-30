import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { AppLayout } from "./AppLayout";
import { AuthProvider } from "../auth";
import { ThemeProvider } from "../theme";
import { SIDEBAR_LABELS_NEED_PX } from "./sidebar-model";

function renderAt(viewportWidth: number) {
  window.innerWidth = viewportWidth;
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter>
            <AppLayout />
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

/** The label is always on the link; only the page ever stops showing it. */
function navLabelShown(label: string): boolean {
  const link = screen.getByRole("link", { name: label });
  return link.textContent?.includes(label) ?? false;
}

describe("AppLayout navigation", () => {
  afterEach(cleanup);

  it("shows the names on a screen with room for them", () => {
    renderAt(SIDEBAR_LABELS_NEED_PX + 400);

    expect(navLabelShown("Repositories")).toBe(true);
    expect(screen.getByText("Admin Console")).toBeTruthy();
  });

  it("starts with only the icons on a screen without", () => {
    renderAt(SIDEBAR_LABELS_NEED_PX - 200);

    expect(navLabelShown("Repositories")).toBe(false);
    // Every destination is still reachable and still named, to a screen reader
    // and to anyone hovering it.
    expect(screen.getByRole("link", { name: "Tokens" })).toBeTruthy();
    expect(screen.queryByText("Admin Console")).toBeNull();
  });

  it("collapses to the mark alone, which is what opens it again", async () => {
    renderAt(SIDEBAR_LABELS_NEED_PX + 400);

    await userEvent.click(screen.getByRole("button", { name: "Collapse navigation" }));
    expect(navLabelShown("Repositories")).toBe(false);
    expect(screen.queryByText("Axis Repository")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Expand navigation" }));
    expect(navLabelShown("Repositories")).toBe(true);
  });
});
