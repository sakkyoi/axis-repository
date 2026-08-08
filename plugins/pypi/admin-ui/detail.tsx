import { useState } from "react";
import { RotateCw, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  CodeBlock,
  DestructiveActionDialog,
  EmptyState,
  ErrorState,
  useErrorToast,
  useToast,
  Input,
  repositoryIndexJobIsActive,
  repositoryIndexJobStatusView,
  useRepositoryArtifactIndexJob,
  type Repository,
  type RepositoryPlugin,
} from "@axis-repository/admin-ui/plugin-ui";
import {
  usePurgePypiProxyCache,
  usePypiClientInfo,
  usePypiProject,
  usePypiProjects,
  usePypiProxyCache,
  useRefreshPypiProxyCache,
  useSetPypiFileYanked,
} from "./api";

export function pypiSimpleIndexUrl(repository: Repository): string {
  return `/repositories/${repository.name}/simple/`;
}

function pypiAuthenticatedIndexUrl(pipIndexUrl: string): string {
  try {
    const url = new URL(pipIndexUrl);
    return `${url.protocol}//axis:\${AXIS_PYPI_TOKEN}@${url.host}${url.pathname}${url.search}${url.hash}`;
  } catch {
    return pipIndexUrl;
  }
}

export function pypiInstallCommandText(repository: Repository, pipIndexUrl = pypiSimpleIndexUrl(repository)): string {
  if (repository.visibility === "private") {
    return [
      "# Use a read token for private repositories.",
      "export AXIS_PYPI_TOKEN=\"<READ_TOKEN>\"",
      "",
      "# Install packages from this repository.",
      "pip install \\",
      `  --index-url "${pypiAuthenticatedIndexUrl(pipIndexUrl)}" \\`,
      "  <package>",
    ].join("\n");
  }
  return [
    "# Install packages from this repository.",
    "pip install \\",
    `  --index-url "${pipIndexUrl}" \\`,
    "  <package>",
  ].join("\n");
}

export function pypiProxyUpstreamUrl(repository: Repository): string {
  const pypi = repository.config.pypi;
  if (!pypi || typeof pypi !== "object" || Array.isArray(pypi)) {
    return "";
  }
  const upstreamUrl = (pypi as Record<string, unknown>).upstreamUrl;
  return typeof upstreamUrl === "string" ? upstreamUrl : "";
}

export function PypiProxySettingsSection({
  repository,
}: {
  repository: Repository;
  pluginMetadata: RepositoryPlugin | undefined;
}) {
  const refresh = useRefreshPypiProxyCache(repository.name);
  const byteCache = usePypiProxyCache(repository.name, repository.kind === "proxy");
  const purgeByteCache = usePurgePypiProxyCache(repository.name);
  const indexJob = useRepositoryArtifactIndexJob(repository.name);
  const indexJobView = repositoryIndexJobStatusView(indexJob.data?.job);
  const indexJobIsActive = repositoryIndexJobIsActive(indexJob.data?.job);
  const [purgeDialogOpen, setPurgeDialogOpen] = useState(false);
  const toast = useToast();
  useErrorToast("PyPI proxy cache refresh failed", refresh.error);
  useErrorToast("PyPI proxy byte cache unavailable", byteCache.error);
  useErrorToast("PyPI proxy byte cache purge failed", purgeByteCache.error);
  const byteCacheStats = byteCache.data;
  const purgeDisabled = purgeByteCache.isPending || !byteCacheStats || byteCacheStats.fileCount === 0;

  function confirmPurgeByteCache() {
    purgeByteCache.mutate(undefined, {
      onSuccess: (result) => {
        setPurgeDialogOpen(false);
        toast.notify({
          title: "PyPI proxy byte cache purge started",
          description: `Background job ${result.job.id} is purging cached files.`,
        });
      },
    });
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <span className="text-xs font-medium uppercase text-muted-foreground">Upstream URL</span>
        <CodeBlock
          className="max-w-full whitespace-pre-wrap break-words"
          language="text"
          code={pypiProxyUpstreamUrl(repository) || "(not configured)"}
          copyable={Boolean(pypiProxyUpstreamUrl(repository))}
        />
      </div>
      {indexJobView && (
        <div className={[
          "rounded-md border px-3 py-2 text-xs",
          indexJobView.failed
            ? "border-destructive/40 bg-destructive/10 text-destructive"
            : "border-border bg-muted/30 text-muted-foreground",
        ].join(" ")}>
          <span className="font-medium text-foreground">{indexJobView.label}</span>
          <span className="ml-2">{indexJobView.description}</span>
        </div>
      )}
      <Button type="button" variant="outline" onClick={() => refresh.mutate()} disabled={refresh.isPending || indexJobIsActive}>
        <RotateCw className="mr-2 h-4 w-4" />
        {refresh.isPending || indexJobIsActive ? "Refreshing..." : "Refresh upstream cache"}
      </Button>
      <div className="grid gap-2 rounded-md border border-border bg-background/40 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="grid gap-0.5">
            <span className="text-xs font-medium uppercase text-muted-foreground">Byte cache</span>
            <span className="text-sm">
              {byteCache.isLoading
                ? "Loading..."
                : byteCacheStats
                  ? `${byteCacheStats.fileCount} files, ${formatBytes(byteCacheStats.byteCount)}`
                  : "-"}
            </span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={purgeDisabled}
            onClick={() => setPurgeDialogOpen(true)}
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" />
            {purgeByteCache.isPending ? "Purging..." : "Purge"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Clears cached upstream file bytes only. Project indexes and artifact metadata are kept.
        </p>
      </div>
      <DestructiveActionDialog
        open={purgeDialogOpen}
        onOpenChange={setPurgeDialogOpen}
        pending={purgeByteCache.isPending}
        error={purgeByteCache.isError ? purgeByteCache.error : undefined}
        title="Purge PyPI proxy byte cache"
        description={[
          `This removes downloaded upstream file bytes cached for ${repository.name}.`,
          "Project index data stays in place, and future downloads can cache files again.",
        ].join("\n")}
        confirmLabel="Purge cache"
        pendingLabel="Purging..."
        confirmationText={repository.name}
        onConfirm={confirmPurgeByteCache}
      />
    </div>
  );
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const digits = unitIndex === 0 || size >= 10 ? 0 : 1;
  return `${size.toFixed(digits)} ${units[unitIndex]}`;
}

export function pypiUploadUrl(repository: Repository, origin = globalThis.location?.origin): string {
  const path = `/repositories/${repository.name}/legacy/`;
  return origin ? `${origin.replace(/\/+$/g, "")}${path}` : path;
}

/**
 * How to publish with twine.
 *
 * Publish tokens use the shared Axis token-auth username and put the token in
 * as the password.
 */
export function pypiUploadCommandText(repository: Repository, origin?: string): string {
  return [
    "# A publish token for this repository.",
    "export TWINE_USERNAME=axis",
    "export TWINE_PASSWORD=\"<PUBLISH_TOKEN>\"",
    "",
    "# Upload a built wheel and sdist.",
    "twine upload \\",
    `  --repository-url "${pypiUploadUrl(repository, origin)}" \\`,
    "  dist/*",
  ].join("\n");
}

export function PypiInstallHintsSection({
  repository,
}: {
  repository: Repository;
  pluginMetadata: RepositoryPlugin | undefined;
}) {
  const clientInfo = usePypiClientInfo(repository.name, true);

  return (
    <>
      <details className="min-w-0" open>
        <summary className="cursor-pointer text-sm font-medium">pip install</summary>
        <CodeBlock
          className="mt-2 max-h-64 max-w-full whitespace-pre-wrap break-words"
          language="shell"
          code={clientInfo.data ? pypiInstallCommandText(repository, clientInfo.data.pipIndexUrl) : "Loading..."}
        />
      </details>
      {clientInfo.isError && <ErrorState title="PyPI client setup unavailable" error={clientInfo.error} />}
    </>
  );
}

export function PypiUploadHintsSection({
  repository,
}: {
  repository: Repository;
  pluginMetadata: RepositoryPlugin | undefined;
}) {
  return (
    <>
      <details className="min-w-0">
        <summary className="cursor-pointer text-sm font-medium">twine upload</summary>
        <CodeBlock
          className="mt-2 max-h-64 max-w-full whitespace-pre-wrap break-words"
          language="shell"
          code={pypiUploadCommandText(repository)}
        />
      </details>
    </>
  );
}

/**
 * The published files of every project, with their yank state.
 *
 * Read from the pages clients are actually served, so what an operator sees
 * here is what pip sees.
 */
export function PypiProjectFilesSection({
  repository,
}: {
  repository: Repository;
  pluginMetadata: RepositoryPlugin | undefined;
}) {
  const projects = usePypiProjects(repository.name);
  const setYanked = useSetPypiFileYanked();
  useErrorToast("Could not change yank state", setYanked.error);
  const [pendingYank, setPendingYank] = useState<{ project: string; filename: string } | null>(null);
  const [reason, setReason] = useState("");
  const [openProjectName, setOpenProjectName] = useState<string>();
  const openProject = usePypiProject(repository.name, openProjectName);
  const canYank = repository.kind === "hosted";
  const projectRows = projects.data?.pages.flatMap((page) => page.projects) ?? [];

  if (projects.isError) {
    return <ErrorState title="PyPI projects unavailable" error={projects.error} />;
  }
  if (!projects.data) {
    return <p className="text-sm text-muted-foreground">Loading...</p>;
  }
  if (projectRows.length === 0) {
    return <EmptyState message="No projects published yet" />;
  }

  return (
    <div className="grid gap-4">
      {projectRows.map((project) => (
        <div key={project.name} className="grid gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-medium">{project.name}</h4>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpenProjectName(openProjectName === project.name ? undefined : project.name)}
            >
              {openProjectName === project.name ? "Hide files" : project.fileCount === undefined ? "Show files" : `Show ${project.fileCount} files`}
            </Button>
          </div>
          {openProjectName === project.name && openProject.isLoading && (
            <p className="text-xs text-muted-foreground">Loading files...</p>
          )}
          {openProjectName === project.name && openProject.isError && (
            <ErrorState title="PyPI project unavailable" error={openProject.error} />
          )}
          {openProjectName === project.name && openProject.data && (
            <ul className="grid gap-1">
              {openProject.data.files.map((file) => (
                <li key={file.filename} className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={file.yanked === undefined ? "" : "text-muted-foreground line-through"}>
                    {file.filename}
                  </span>
                  {file.yanked !== undefined && (
                    <Badge variant="warning">
                      {file.yanked === "" ? "yanked" : `yanked: ${file.yanked}`}
                    </Badge>
                  )}
                  {canYank && (file.yanked === undefined ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={setYanked.isPending}
                      onClick={() => {
                        setReason("");
                        setPendingYank({ project: project.name, filename: file.filename });
                      }}
                    >
                      Yank
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={setYanked.isPending}
                      onClick={() => setYanked.mutate({
                        repositoryName: repository.name,
                        project: project.name,
                        filename: file.filename,
                        reason: undefined,
                        yanked: false,
                      })}
                    >
                      Unyank
                    </Button>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}

      {projects.hasNextPage && (
        <Button
          type="button"
          variant="outline"
          disabled={projects.isFetchingNextPage}
          onClick={() => void projects.fetchNextPage()}
        >
          {projects.isFetchingNextPage ? "Loading..." : "Load more"}
        </Button>
      )}

      {pendingYank && (
        <div className="grid gap-2 rounded-md border p-3">
          <p className="text-sm">
            Yank <span className="font-mono">{pendingYank.filename}</span>? It stays downloadable, so anything
            already pinning it keeps working, but pip passes over it.
          </p>
          <Input
            placeholder="Reason (optional)"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <div className="flex gap-2">
            <Button
              type="button"
              disabled={setYanked.isPending}
              onClick={() => {
                setYanked.mutate({
                  repositoryName: repository.name,
                  project: pendingYank.project,
                  filename: pendingYank.filename,
                  reason,
                  yanked: true,
                });
                setPendingYank(null);
              }}
            >
              Yank
            </Button>
            <Button type="button" variant="outline" onClick={() => setPendingYank(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
