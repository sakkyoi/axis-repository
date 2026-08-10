// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthTestProvider } from "../auth-test-support";
import type { RepositoryPlugin } from "../api/schemas";
import { NewRepositoryPage } from "./NewRepositoryPage";

const listRepositories = vi.fn();
const listRepositoryPlugins = vi.fn();
const createRepository = vi.fn();

vi.mock("../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/client")>()),
  createAxisClient: () => ({
    listRepositories,
    listRepositoryPlugins,
    createRepository,
  }),
}));

function plugin(input: Partial<RepositoryPlugin> & Pick<RepositoryPlugin, "ecosystem">): RepositoryPlugin {
  return {
    ecosystem: input.ecosystem,
    name: input.name ?? `${input.ecosystem}-plugin`,
    version: input.version ?? "0.1.0",
    enabled: input.enabled ?? true,
    catalogEnabled: input.catalogEnabled ?? true,
    enabledOverride: input.enabledOverride,
    experimental: input.experimental ?? false,
    runtime: input.runtime ?? true,
    adminUi: input.adminUi ?? true,
    capabilities: input.capabilities ?? ["simple-api", "publish"],
    repositoryKinds: input.repositoryKinds ?? [{ kind: "hosted", experimental: false }],
    ...(input.icon ? { icon: input.icon } : {}),
    ...(input.clientHelpers ? { clientHelpers: input.clientHelpers } : {}),
  };
}

function renderNewRepositoryPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <AuthTestProvider value={{ accessToken: "token" }}>
        <QueryClientProvider client={queryClient}>
          <NewRepositoryPage />
        </QueryClientProvider>
      </AuthTestProvider>
    </MemoryRouter>,
  );
}

describe("NewRepositoryPage", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("uses the selected plugin ecosystem icon in the summary panel", async () => {
    listRepositories.mockResolvedValueOnce([]);
    listRepositoryPlugins.mockResolvedValueOnce([
      plugin({
        ecosystem: "apt",
        icon: {
          title: "APT",
          accentColor: "#3775a9",
          inlineSvg: '<svg aria-hidden="true" viewBox="0 0 10 10"><path d="M0 0h10v10H0z"/></svg>',
        },
      }),
    ]);

    const { container } = renderNewRepositoryPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "APT / Hosted" })).toBeTruthy();
    });
    expect(container.querySelector('aside svg path[d="M0 0h10v10H0z"]')).toBeTruthy();
  });
});
