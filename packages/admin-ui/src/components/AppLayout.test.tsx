import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { AppLayout } from "./AppLayout";
import { AuthProvider } from "../auth";
import { ThemeProvider } from "../theme";
import { SIDEBAR_LABELS_NEED_PX } from "./sidebar-model";
import { AXIS_SOURCE_URL } from "../navigation";

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
  afterEach(() => {
    cleanup();
    // The panel remembers what it was told, and one test telling it something
    // would otherwise decide for the next.
    window.localStorage.clear();
  });

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

  it("keeps the theme and the account with the navigation", () => {
    // They belong to whoever is signed in rather than to the page, and the top
    // bar had no room for them beside anything else on a narrow screen.
    renderAt(SIDEBAR_LABELS_NEED_PX + 400);

    const aside = document.querySelector("aside")!;
    expect(aside.contains(screen.getByRole("group", { name: "Theme" }))).toBe(true);
    expect(aside.contains(screen.getByRole("button", { name: /Profile|admin/ }))).toBe(true);
  });

  it("still offers the theme when there is no room for its names", () => {
    renderAt(SIDEBAR_LABELS_NEED_PX - 200);

    const dark = screen.getByRole("button", { name: "Dark theme" });
    expect(dark.textContent).toBe("");
  });

  it("links out to where it is built", () => {
    renderAt(SIDEBAR_LABELS_NEED_PX + 400);

    const link = screen.getByRole("link", { name: "Axis Repository on GitHub" });
    expect(link.getAttribute("href")).toBe(AXIS_SOURCE_URL);
    // A link that leaves the console opens beside it, and says nothing about
    // this page to wherever it lands.
    expect(link.getAttribute("rel")).toContain("noreferrer");
  });

  it("opens the way it was left, on a screen that would have opened it", async () => {
    // The choice outlives the visit, not just the resize. Closed on a wide
    // screen and then reopened on one just as wide, it stays closed -- which
    // only the stored answer can produce, since the width says otherwise.
    renderAt(SIDEBAR_LABELS_NEED_PX + 400);
    await userEvent.click(screen.getByRole("button", { name: "Collapse navigation" }));
    expect(navLabelShown("Repositories")).toBe(false);
    cleanup();

    renderAt(SIDEBAR_LABELS_NEED_PX + 400);

    expect(navLabelShown("Repositories")).toBe(false);
  });

  it("lets the screen decide again for someone who has never chosen", () => {
    renderAt(SIDEBAR_LABELS_NEED_PX - 200);
    expect(navLabelShown("Repositories")).toBe(false);
    cleanup();

    renderAt(SIDEBAR_LABELS_NEED_PX + 400);

    expect(navLabelShown("Repositories")).toBe(true);
  });

});
