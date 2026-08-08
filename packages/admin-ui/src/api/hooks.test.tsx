// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
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

function wrapperWith(queryClient: QueryClient) {
  return function TestWrapper({ children }: { children: ReactNode }) {
    return (
      <AuthTestProvider value={{ accessToken: "token" }}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </AuthTestProvider>
    );
  };
}

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

  it("caches repository index status under the generic background job key", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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

    renderHook(() => useRepositoryArtifactIndexJob("python-proxy"), { wrapper: wrapperWith(queryClient) });

    await waitFor(() => {
      expect(queryClient.getQueryData(["background-job", "repository.index:python-proxy"])).toMatchObject({
        job: { id: "repository.index:python-proxy" },
      });
    });
    expect(queryClient.getQueryData(["repository-artifact-index-job", "python-proxy"])).toBeUndefined();
  });

  it("invalidates artifact family pages when an index job finishes", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    getBackgroundJob
      .mockResolvedValueOnce({
        id: "repository.index:python-proxy",
        type: "repository.index.proxy-refresh",
        status: "running",
        subject: { type: "repository", id: "python-proxy", repositoryName: "python-proxy" },
        repositoryName: "python-proxy",
        priority: 0,
        requestedAt: "2026-08-05T00:00:00.000Z",
        scheduledAt: "2026-08-05T00:00:00.000Z",
        startedAt: "2026-08-05T00:00:01.000Z",
        attempts: 1,
      })
      .mockResolvedValueOnce({
        id: "repository.index:python-proxy",
        type: "repository.index.proxy-refresh",
        status: "succeeded",
        subject: { type: "repository", id: "python-proxy", repositoryName: "python-proxy" },
        repositoryName: "python-proxy",
        priority: 0,
        requestedAt: "2026-08-05T00:00:00.000Z",
        scheduledAt: "2026-08-05T00:00:00.000Z",
        startedAt: "2026-08-05T00:00:01.000Z",
        finishedAt: "2026-08-05T00:00:02.000Z",
        attempts: 1,
      });

    const { result } = renderHook(() => useRepositoryArtifactIndexJob("python-proxy"), {
      wrapper: wrapperWith(queryClient),
    });

    await waitFor(() => expect(result.current.data?.job?.status).toBe("running"));
    await act(async () => {
      await result.current.refetch();
    });
    await waitFor(() => expect(result.current.data?.job?.status).toBe("succeeded"));

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["repository-artifact-families", "python-proxy", "pages"],
    });
    expect(invalidateQueries).not.toHaveBeenCalledWith({
      queryKey: ["repository-objects", "python-proxy"],
    });
  });
});
