// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AuthTestProvider } from "../../auth-test-support";
import { ToastProvider } from "../../components/ui/toast";
import { RepositoryProxyIndexRefreshButton } from "./repository-proxy-cache";

const rebuildRepositoryArtifactIndex = vi.fn();
const getBackgroundJob = vi.fn();

vi.mock("../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/client")>()),
  createAxisClient: () => ({
    rebuildRepositoryArtifactIndex,
    getBackgroundJob,
  }),
}));

describe("RepositoryProxyIndexRefreshButton", () => {
  it("queues a generic repository index refresh and invalidates extra plugin-owned data", async () => {
    getBackgroundJob.mockResolvedValue(null);
    rebuildRepositoryArtifactIndex.mockResolvedValue({
      job: {
        id: "repository.index:python-proxy",
        type: "repository.index.proxy-refresh",
        status: "pending",
      },
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    render(
      <AuthTestProvider value={{ accessToken: "token" }}>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <RepositoryProxyIndexRefreshButton
              repositoryName="python-proxy"
              label="Refresh upstream cache"
              pendingLabel="Refreshing..."
              errorTitle="Proxy index refresh failed"
              extraInvalidateQueryKeys={[["pypi-projects", "python-proxy"]]}
            />
          </ToastProvider>
        </QueryClientProvider>
      </AuthTestProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Refresh upstream cache/u }));

    await waitFor(() => expect(rebuildRepositoryArtifactIndex).toHaveBeenCalledWith("python-proxy"));
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["pypi-projects", "python-proxy"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["repository-objects", "python-proxy"] });
  });
});
