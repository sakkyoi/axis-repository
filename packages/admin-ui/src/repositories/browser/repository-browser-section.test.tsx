// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthTestProvider } from "../../auth-test-support";
import { ToastProvider } from "../../components/ui/toast";
import { RepositoryBrowserSection } from "./repository-browser-section";

const listRepositoryObjects = vi.fn();
const getRepositoryObjectDetail = vi.fn();
const listRepositoryArtifacts = vi.fn();
const deleteRepositoryObject = vi.fn();

vi.mock("../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/client")>()),
  createAxisClient: () => ({
    listRepositoryObjects,
    getRepositoryObjectDetail,
    listRepositoryArtifacts,
    deleteRepositoryObject,
  }),
}));

function renderSection(initialEntries = ["/ui/repositories/debian-internal"]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <AuthTestProvider value={{ accessToken: "token" }}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={initialEntries}>
          <ToastProvider>
            <RepositoryBrowserSection
              repository={{
                id: "repo_1",
                name: "debian-internal",
                ecosystem: "apt",
                kind: "hosted",
                visibility: "private",
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

describe("RepositoryBrowserSection", () => {
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it("loads a directory prefix when a directory row is opened", async () => {
    listRepositoryArtifacts.mockResolvedValue({ artifacts: [], truncated: false });
    listRepositoryObjects
      .mockResolvedValueOnce({
        prefix: "",
        directories: [{ name: "pool", path: "pool/" }],
        objects: [],
        truncated: false,
      })
      .mockResolvedValueOnce({
        prefix: "pool/",
        directories: [],
        objects: [{ name: "demo.deb", path: "pool/demo.deb", size: 12, contentType: "application/vnd.debian.binary-package" }],
        truncated: false,
      });

    const view = renderSection();

    fireEvent.click(await view.findByRole("button", { name: "pool" }));

    await waitFor(() => {
      expect(listRepositoryObjects).toHaveBeenCalledWith("debian-internal", "pool/");
    });
    expect(await view.findByRole("button", { name: "demo.deb" })).toBeTruthy();
  });

  it("opens object detail from the object query parameter", async () => {
    listRepositoryObjects.mockResolvedValue({
      prefix: "pool/",
      directories: [],
      objects: [{ name: "demo.deb", path: "pool/demo.deb", size: 12, contentType: "application/vnd.debian.binary-package" }],
      truncated: false,
    });
    listRepositoryArtifacts.mockResolvedValue({
      artifacts: [{
        id: "artifact_demo",
        repositoryName: "debian-internal",
        ecosystem: "apt",
        identity: "apt:demo:1.0:amd64",
        name: "demo",
        summary: "demo 1.0 amd64",
        objectKeys: ["repositories/debian-internal/pool/demo.deb"],
        metadata: {},
        publishedAt: "2026-08-05T00:00:00.000Z",
        updatedAt: "2026-08-05T00:00:00.000Z",
      }],
      truncated: false,
    });
    getRepositoryObjectDetail.mockResolvedValue({
      name: "demo.deb",
      path: "pool/demo.deb",
      objectKey: "repositories/debian-internal/pool/demo.deb",
      repositoryUrl: "https://axis.example/repositories/debian-internal/pool/demo.deb",
      size: 12,
      contentType: "application/vnd.debian.binary-package",
      etag: "\"demo\"",
    });

    const view = renderSection(["/ui/repositories/debian-internal?object=pool/demo.deb"]);

    await waitFor(() => {
      expect(listRepositoryObjects).toHaveBeenCalledWith("debian-internal", "pool/");
      expect(getRepositoryObjectDetail).toHaveBeenCalledWith("debian-internal", "pool/demo.deb");
    });
    expect(await view.findByText("Object key")).toBeTruthy();
    expect(view.getByText("demo 1.0 amd64")).toBeTruthy();
  });
});
