// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthTestProvider } from "../auth-test-support";
import type { BackgroundJob } from "../api/schemas";
import { JobsPage } from "./JobsPage";

const listBackgroundJobs = vi.fn();
const cancelBackgroundJob = vi.fn();
const retryBackgroundJob = vi.fn();

vi.mock("../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/client")>()),
  createAxisClient: () => ({
    listBackgroundJobs,
    cancelBackgroundJob,
    retryBackgroundJob,
  }),
}));

function job(id: string): BackgroundJob {
  return {
    id,
    type: "repository.index.proxy-refresh",
    status: "pending",
    subject: { type: "repository", id },
    priority: 0,
    attempts: 0,
    requestedAt: "2026-08-05T00:00:00.000Z",
    scheduledAt: "2026-08-05T00:00:00.000Z",
  };
}

function renderJobsPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <AuthTestProvider value={{ accessToken: "token" }}>
      <QueryClientProvider client={queryClient}>
        <JobsPage />
      </QueryClientProvider>
    </AuthTestProvider>,
  );
}

describe("JobsPage", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("pages through background jobs instead of hiding records past the first page", async () => {
    listBackgroundJobs
      .mockResolvedValueOnce({ jobs: Array.from({ length: 50 }, (_, index) => job(`job_${index + 1}`)), total: 51 })
      .mockResolvedValueOnce({ jobs: [job("job_51")], total: 51 })
      .mockResolvedValueOnce({ jobs: Array.from({ length: 50 }, (_, index) => job(`job_${index + 1}`)), total: 51 });

    renderJobsPage();

    await waitFor(() => {
      expect(screen.getByText("Showing 1-50 of 51")).toBeTruthy();
    });
    expect(listBackgroundJobs).toHaveBeenLastCalledWith({ limit: 50, offset: 0 });

    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => {
      expect(screen.getByText("Showing 51-51 of 51")).toBeTruthy();
    });
    expect(listBackgroundJobs).toHaveBeenLastCalledWith({ limit: 50, offset: 50 });

    await userEvent.click(screen.getByRole("button", { name: "Previous page" }));
    await waitFor(() => {
      expect(screen.getByText("Showing 1-50 of 51")).toBeTruthy();
    });
    expect(listBackgroundJobs).toHaveBeenLastCalledWith({ limit: 50, offset: 0 });
  });

  it("filters jobs by status and resets back to the first page", async () => {
    listBackgroundJobs
      .mockResolvedValueOnce({ jobs: Array.from({ length: 50 }, (_, index) => job(`job_${index + 1}`)), total: 51 })
      .mockResolvedValueOnce({ jobs: [job("job_51")], total: 51 })
      .mockResolvedValueOnce({ jobs: [{ ...job("failed_job"), status: "failed" }], total: 1 });

    renderJobsPage();

    await waitFor(() => {
      expect(screen.getByText("Showing 1-50 of 51")).toBeTruthy();
    });
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => {
      expect(screen.getByText("Showing 51-51 of 51")).toBeTruthy();
    });

    await userEvent.click(screen.getByRole("button", { name: "Failed" }));
    await waitFor(() => {
      expect(screen.getByText("Showing 1-1 of 1")).toBeTruthy();
    });
    expect(listBackgroundJobs).toHaveBeenLastCalledWith({ limit: 50, offset: 0, status: "failed" });
  });

  it("keeps result and actions columns inside a stable horizontally scrollable table", async () => {
    listBackgroundJobs.mockResolvedValueOnce({
      jobs: [{ ...job("repository.delete:very-long-repository-name"), status: "succeeded" }],
      total: 1,
    });

    renderJobsPage();

    await waitFor(() => {
      expect(screen.getByText("Showing 1-1 of 1")).toBeTruthy();
    });

    const scrollArea = screen.getByTestId("jobs-table-scroll-area");
    const table = screen.getByRole("table", { name: "Background jobs" });
    const resultHeader = screen.getByRole("columnheader", { name: "Result" });
    const actionsHeader = screen.getByRole("columnheader", { name: "Actions" });

    expect(scrollArea.className).toContain("overflow-x-auto");
    expect(table.className).toContain("min-w-[82rem]");
    expect(resultHeader.className).toContain("min-w-0");
    expect(actionsHeader.className).toContain("text-right");
  });

  it("keeps job status filters visible at the top of the scrolling page body", async () => {
    listBackgroundJobs.mockResolvedValueOnce({
      jobs: [job("repository.index:python-proxy")],
      total: 1,
    });

    renderJobsPage();

    await waitFor(() => {
      expect(screen.getByText("Showing 1-1 of 1")).toBeTruthy();
    });

    const filters = screen.getByLabelText("Job status filters");
    expect(filters.className).toContain("sticky");
    expect(filters.className).toContain("top-0");
    expect(filters.className).toContain("z-10");
  });
});
