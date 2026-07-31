// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthTestProvider } from "../auth-test-support";
import { RepositoryWorkspacePage } from "./RepositoryWorkspacePage";

// The repository list is what decides whether a name exists, so an empty one
// is a page addressed at a repository that is not there.
vi.mock("../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/client")>()),
  createAxisClient: () => ({
    listRepositories: async () => [],
    listRepositoryPlugins: async () => [],
  }),
}));

function renderMissingRepository() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <AuthTestProvider value={{ accessToken: "token" }}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/ui/repositories/a"]}>
          <Routes>
            <Route path="/ui/repositories/:name" element={<RepositoryWorkspacePage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </AuthTestProvider>,
  );
}

describe("a repository workspace addressed at a name that does not exist", () => {
  afterEach(cleanup);

  it("names what was looked for and offers the way back", async () => {
    // It used to read "Repository not found: a" and stop there, leaving no
    // route out: the header's own Repositories button is only rendered when
    // there is a repository to render it beside.
    renderMissingRepository();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Repository not found" })).toBeTruthy();
    });
    expect(screen.getByText(/named a\./)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Repositories/ })).toBeTruthy();
  });

  it("drops the description written for the page it would have been", async () => {
    renderMissingRepository();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Repository not found" })).toBeTruthy();
    });
    expect(screen.queryByText(/Publish artifacts and inspect client setup/)).toBeNull();
  });

  it("draws the panel once rather than a box inside a box", async () => {
    // The solid panel is the repository's frame; the not-found state brings a
    // dashed one of its own, and both were drawn.
    const { container } = renderMissingRepository();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Repository not found" })).toBeTruthy();
    });
    const dashed = container.querySelector(".border-dashed");
    expect(dashed).not.toBeNull();
    expect(dashed?.closest(".bg-panel")).toBe(dashed);
  });
});
