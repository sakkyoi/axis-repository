// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthTestProvider } from "../../auth-test-support";
import { ToastProvider } from "../../components/ui/toast";
import { RepositoryArtifactsSection } from "./repository-artifacts-section";

const listRepositoryArtifactFamilies = vi.fn();
const listRepositoryArtifacts = vi.fn();
const getRepositoryPluginResource = vi.fn();
const getBackgroundJob = vi.fn();
const originalIntersectionObserver = globalThis.IntersectionObserver;
let intersectionObserverCallback: IntersectionObserverCallback | undefined;

vi.mock("../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/client")>()),
  createAxisClient: () => ({
    listRepositoryArtifactFamilies,
    listRepositoryArtifacts,
    getRepositoryPluginResource,
    getBackgroundJob,
    rebuildRepositoryArtifactIndex: vi.fn(),
    deleteRepositoryArtifact: vi.fn(),
  }),
}));

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <AuthTestProvider value={{ accessToken: "token" }}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ToastProvider>
            <RepositoryArtifactsSection
              repository={{
                id: "repo_1",
                name: "python-proxy",
                ecosystem: "pypi",
                kind: "proxy",
                visibility: "public",
                config: {},
                createdAt: "2026-08-05T00:00:00.000Z",
                updatedAt: "2026-08-05T00:00:00.000Z",
              }}
              pluginMetadata={undefined}
            />
          </ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </AuthTestProvider>,
  );
}

describe("RepositoryArtifactsSection", () => {
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
    intersectionObserverCallback = undefined;
    globalThis.IntersectionObserver = originalIntersectionObserver;
  });

  it("fetches PyPI proxy project details when opening a proxy project artifact", async () => {
    getBackgroundJob.mockResolvedValue(null);
    listRepositoryArtifactFamilies.mockResolvedValue({
      families: [{
        key: "pypi:proxy-project:demo",
        repositoryName: "python-proxy",
        ecosystem: "pypi",
        name: "demo",
        latestSummary: "demo",
        latestPublishedAt: "2026-08-05T00:00:00.000Z",
        updatedAt: "2026-08-05T00:00:00.000Z",
        artifactCount: 1,
        versionCount: 0,
        latestArtifact: {
          id: "artifact_python-proxy_pypi_proxy_project_demo",
          repositoryName: "python-proxy",
          ecosystem: "pypi",
          identity: "pypi:proxy-project:demo",
          family: "pypi:proxy-project:demo",
          name: "demo",
          summary: "demo",
          objectKeys: [],
          metadata: {},
          publishedAt: "2026-08-05T00:00:00.000Z",
          updatedAt: "2026-08-05T00:00:00.000Z",
        },
      }],
      totalFamilies: 1,
      totalArtifacts: 1,
      truncated: false,
    });
    listRepositoryArtifacts.mockResolvedValue({
      artifacts: [{
        id: "artifact_python-proxy_pypi_proxy_project_demo",
        repositoryName: "python-proxy",
        ecosystem: "pypi",
        identity: "pypi:proxy-project:demo",
        family: "pypi:proxy-project:demo",
        name: "demo",
        summary: "demo",
        objectKeys: [],
        metadata: {},
        publishedAt: "2026-08-05T00:00:00.000Z",
        updatedAt: "2026-08-05T00:00:00.000Z",
      }],
      truncated: false,
    });
    getRepositoryPluginResource.mockResolvedValue({
      project: {
        name: "demo",
        files: [{ filename: "demo-1.0.tar.gz" }],
      },
    });

    const view = renderSection();

    fireEvent.click(await view.findByLabelText("Open demo"));

    await waitFor(() => {
      expect(getRepositoryPluginResource).toHaveBeenCalledWith("python-proxy", "pypi", ["projects", "demo"]);
    });
  });

  it("loads the next artifact page when the table scrolls to the bottom", async () => {
    getBackgroundJob.mockResolvedValue(null);
    const observe = vi.fn();
    const disconnect = vi.fn();
    window.IntersectionObserver = vi.fn(function mockIntersectionObserver(callback) {
      intersectionObserverCallback = callback;
      return {
        observe,
        unobserve: vi.fn(),
        disconnect,
        root: null,
        rootMargin: "",
        thresholds: [],
        takeRecords: () => [],
      };
    }) as unknown as typeof IntersectionObserver;
    listRepositoryArtifactFamilies
      .mockResolvedValueOnce({
        families: [{
          key: "pkg:first",
          repositoryName: "python-proxy",
          ecosystem: "pypi",
          name: "first",
          latestSummary: "first",
          latestVersion: "1.0",
          latestPublishedAt: "2026-08-05T00:00:00.000Z",
          updatedAt: "2026-08-05T00:00:00.000Z",
          artifactCount: 1,
          versionCount: 1,
          latestArtifact: artifactFamilyLatest("first"),
        }],
        totalFamilies: 2,
        totalArtifacts: 2,
        cursor: "page_2",
      })
      .mockResolvedValueOnce({
        families: [{
          key: "pkg:second",
          repositoryName: "python-proxy",
          ecosystem: "pypi",
          name: "second",
          latestSummary: "second",
          latestVersion: "1.0",
          latestPublishedAt: "2026-08-05T00:00:00.000Z",
          updatedAt: "2026-08-05T00:00:00.000Z",
          artifactCount: 1,
          versionCount: 1,
          latestArtifact: artifactFamilyLatest("second"),
        }],
        totalFamilies: 2,
        totalArtifacts: 2,
      });

    const view = renderSection();

    expect(await view.findByLabelText("Open first")).not.toBeNull();
    expect(view.queryByRole("button", { name: "Load more" })).toBeNull();
    expect(observe).toHaveBeenCalled();

    intersectionObserverCallback?.([
      { isIntersecting: true } as IntersectionObserverEntry,
    ], {} as IntersectionObserver);

    await waitFor(() => {
      expect(listRepositoryArtifactFamilies).toHaveBeenCalledWith("python-proxy", {
        limit: 50,
        cursor: "page_2",
      });
    });
    expect(await view.findByLabelText("Open second")).not.toBeNull();
    expect(disconnect).toHaveBeenCalled();
  });

  it("labels artifact counts as cached while the index is refreshing", async () => {
    getBackgroundJob.mockResolvedValue({
      id: "repository.index:python-proxy",
      type: "repository.index.proxy-refresh",
      status: "running",
      subject: { type: "repository", id: "python-proxy", repositoryName: "python-proxy" },
      repositoryName: "python-proxy",
      priority: 0,
      attempts: 1,
      requestedAt: "2026-08-05T00:00:00.000Z",
      scheduledAt: "2026-08-05T00:00:00.000Z",
      startedAt: "2026-08-05T00:00:01.000Z",
    });
    listRepositoryArtifactFamilies.mockResolvedValue({
      families: [{
        key: "pkg:first",
        repositoryName: "python-proxy",
        ecosystem: "pypi",
        name: "first",
        latestSummary: "first",
        latestVersion: "1.0",
        latestPublishedAt: "2026-08-05T00:00:00.000Z",
        updatedAt: "2026-08-05T00:00:00.000Z",
        artifactCount: 1,
        versionCount: 1,
        latestArtifact: artifactFamilyLatest("first"),
      }],
      totalFamilies: 718,
      totalArtifacts: 6144,
      truncated: false,
    });

    const view = renderSection();

    expect(await view.findByText("Cached 718 packages, 6144 artifacts")).not.toBeNull();
  });
});

function artifactFamilyLatest(name: string) {
  return {
    id: `artifact_${name}`,
    repositoryName: "python-proxy",
    ecosystem: "pypi",
    identity: `pkg:${name}`,
    family: `pkg:${name}`,
    name,
    version: "1.0",
    summary: name,
    objectKeys: [],
    metadata: {},
    publishedAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:00.000Z",
  };
}
