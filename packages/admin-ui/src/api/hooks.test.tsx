// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthTestProvider } from "../auth-test-support";
import { useRepositoryArtifactIndexJob } from "./hooks";

const getBackgroundJob = vi.fn();

vi.mock("./client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./client")>()),
  createAxisClient: () => ({
    getBackgroundJob,
  }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <AuthTestProvider value={{ accessToken: "token" }}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </AuthTestProvider>
  );
}

describe("useRepositoryArtifactIndexJob", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("reads repository index status from the shared background job contract", async () => {
    getBackgroundJob.mockResolvedValue({
      id: "repository.index:python-proxy",
      type: "repository.index.proxy-refresh",
      status: "pending",
      subject: { type: "repository", id: "python-proxy", repositoryName: "python-proxy" },
      repositoryName: "python-proxy",
      priority: 0,
      requestedAt: "2026-08-05T00:00:00.000Z",
      scheduledAt: "2026-08-05T00:00:00.000Z",
      attempts: 0,
    });

    const { result } = renderHook(() => useRepositoryArtifactIndexJob("python-proxy"), { wrapper });

    await waitFor(() => expect(result.current.data?.job?.id).toBe("repository.index:python-proxy"));
    expect(getBackgroundJob).toHaveBeenCalledWith("repository.index:python-proxy");
  });
});
