// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthTestProvider } from "../auth-test-support";
import type { RepositoryPlugin } from "../api/schemas";
import { ToastProvider } from "../components/ui/toast";
import { SettingsPage } from "./SettingsPage";

const listRepositoryPlugins = vi.fn();
const getDeployment = vi.fn();
const getRuntimeSettings = vi.fn();
const updateRuntimeSettings = vi.fn();
const updateRepositoryPluginPolicy = vi.fn();

vi.mock("../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/client")>()),
  createAxisClient: () => ({
    listRepositoryPlugins,
    getDeployment,
    getRuntimeSettings,
    updateRuntimeSettings,
    updateRepositoryPluginPolicy,
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
    experimental: input.experimental,
    runtime: input.runtime ?? true,
    adminUi: input.adminUi ?? true,
    capabilities: input.capabilities ?? ["simple-api", "publish"],
    repositoryKinds: input.repositoryKinds ?? [{ kind: "hosted", experimental: false }],
    ...(input.clientHelpers ? { clientHelpers: input.clientHelpers } : {}),
  };
}

function renderSettingsPage(initialEntry = "/ui/settings") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AuthTestProvider value={{ accessToken: "token" }}>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <SettingsPage />
          </ToastProvider>
        </QueryClientProvider>
      </AuthTestProvider>
    </MemoryRouter>,
  );
}

describe("SettingsPage", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("keeps repository plugin actions inside a stable horizontally scrollable table", async () => {
    listRepositoryPlugins.mockResolvedValueOnce([
      plugin({
        ecosystem: "pypi",
        name: "Python Package Index",
        capabilities: ["simple-api", "proxy-cache", "very-long-capability-name"],
        repositoryKinds: [
          { kind: "hosted", experimental: false },
          { kind: "proxy", experimental: true },
          { kind: "group", experimental: true },
        ],
        clientHelpers: {
          namespace: "pypi",
          actions: [
            { name: "install", label: "install", responseKind: "shell", defaultOpen: true, public: true },
            { name: "upload", label: "upload", responseKind: "shell", defaultOpen: false, public: false },
          ],
        },
      }),
    ]);
    getDeployment.mockResolvedValueOnce({ capabilities: {}, leftoverBootstrapCredentials: [] });
    getRuntimeSettings.mockResolvedValueOnce({
      settings: {
        operationalPolicy: {
          proxy: {
            upstreamFetchTimeoutMs: 5000,
            upstreamRequestRetries: 2,
            upstreamRetryBaseDelayMs: 250,
            upstreamRetryMaxDelayMs: 1000,
            indexCatalogBatchSize: 200,
            indexProjectDetailBatchSize: 50,
            failedProjectSampleLimit: 20,
            fileByteCache: {
              enabled: true,
              maxBytes: 104857600,
              maxTotalBytes: 1073741824,
              ttlSeconds: 86400,
              respectUpstreamCacheControl: true,
            },
          },
        },
      },
      overrides: {},
    });

    renderSettingsPage();

    await userEvent.click(screen.getByRole("tab", { name: "Repository plugins" }));

    await waitFor(() => {
      expect(screen.getByText("Python Package Index")).toBeTruthy();
    });

    const scrollArea = screen.getByTestId("repository-plugins-table-scroll-area");
    const table = screen.getByRole("table", { name: "Repository plugins" });
    const actionsHeader = screen.getByRole("columnheader", { name: "Actions" });

    expect(scrollArea.className).toContain("overflow-x-auto");
    expect(table.className).toContain("min-w-[84rem]");
    expect(actionsHeader.className).toContain("text-right");
  });

  it("separates settings into runtime policy, repository plugin, and environment tabs", async () => {
    listRepositoryPlugins.mockResolvedValueOnce([]);
    getDeployment.mockResolvedValueOnce({ capabilities: {}, leftoverBootstrapCredentials: [] });
    getRuntimeSettings.mockResolvedValueOnce({
      settings: {
        operationalPolicy: {
          proxy: {
            upstreamFetchTimeoutMs: 5000,
            upstreamRequestRetries: 2,
            upstreamRetryBaseDelayMs: 250,
            upstreamRetryMaxDelayMs: 1000,
            indexCatalogBatchSize: 200,
            indexProjectDetailBatchSize: 50,
            failedProjectSampleLimit: 20,
            fileByteCache: {
              enabled: true,
              maxBytes: 104857600,
              maxTotalBytes: 1073741824,
              ttlSeconds: 86400,
              respectUpstreamCacheControl: true,
            },
          },
        },
      },
      overrides: {},
    });

    renderSettingsPage();

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Runtime policy" })).toBeTruthy();
    });
    expect(screen.getByRole("tab", { name: "Repository plugins" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Environment" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Proxy runtime policy" })).toBeTruthy();
    expect(screen.queryByText("API target")).toBeNull();

    await userEvent.click(screen.getByRole("tab", { name: "Environment" }));

    expect(screen.getByText("API target")).toBeTruthy();
    expect(screen.getByText("Config source")).toBeTruthy();
    expect(screen.queryByText("Auth storage")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Proxy runtime policy" })).toBeNull();
  });

  it("lays out proxy runtime policy settings as one row per setting", async () => {
    listRepositoryPlugins.mockResolvedValueOnce([]);
    getDeployment.mockResolvedValueOnce({ capabilities: {}, leftoverBootstrapCredentials: [] });
    getRuntimeSettings.mockResolvedValueOnce({
      settings: {
        operationalPolicy: {
          proxy: {
            upstreamFetchTimeoutMs: 5000,
            upstreamRequestRetries: 2,
            upstreamRetryBaseDelayMs: 250,
            upstreamRetryMaxDelayMs: 1000,
            indexCatalogBatchSize: 200,
            indexProjectDetailBatchSize: 50,
            failedProjectSampleLimit: 20,
            fileByteCache: {
              enabled: true,
              maxBytes: 104857600,
              maxTotalBytes: 1073741824,
              ttlSeconds: 86400,
              respectUpstreamCacheControl: true,
            },
          },
        },
      },
      overrides: {},
    });

    renderSettingsPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Proxy runtime policy" })).toBeTruthy();
    });
    const fields = await screen.findByTestId("proxy-runtime-policy-fields");
    expect(fields.className).toContain("grid-cols-1");
    expect(fields.className).toContain("divide-y");
    expect(fields.className).not.toContain("md:grid-cols-2");
    expect(fields.className).not.toContain("xl:grid-cols-4");
    expect(screen.getByTestId("runtime-number-field-upstream-timeout").className).toContain("pr-");
  });

  it("opens the environment tab from the settings tab query", async () => {
    listRepositoryPlugins.mockResolvedValueOnce([]);
    getDeployment.mockResolvedValueOnce({ capabilities: {}, leftoverBootstrapCredentials: [] });
    getRuntimeSettings.mockResolvedValueOnce({
      settings: {
        operationalPolicy: {
          proxy: {
            upstreamFetchTimeoutMs: 5000,
            upstreamRequestRetries: 2,
            upstreamRetryBaseDelayMs: 250,
            upstreamRetryMaxDelayMs: 1000,
            indexCatalogBatchSize: 200,
            indexProjectDetailBatchSize: 50,
            failedProjectSampleLimit: 20,
            fileByteCache: {
              enabled: true,
              maxBytes: 104857600,
              maxTotalBytes: 1073741824,
              ttlSeconds: 86400,
              respectUpstreamCacheControl: true,
            },
          },
        },
      },
      overrides: {},
    });

    renderSettingsPage("/ui/settings?tab=environment#bootstrap-credentials");

    await waitFor(() => {
      expect(screen.getByText("API target")).toBeTruthy();
    });
    expect(screen.queryByRole("heading", { name: "Proxy runtime policy" })).toBeNull();
  });
});
