import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import {
  Badge,
  Button,
  CodeBlock,
  EmptyState,
  ErrorState,
  useErrorToast,
  Input,
  useUpdateRepository,
  VisibilitySelect,
  type Repository,
  type RepositoryPlugin,
  type RepositoryVisibility,
} from "@axis-repository/admin-ui/plugin-ui";
import { usePypiClientInfo, usePypiProjects, useSetPypiFileYanked } from "./api";

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

export function PypiSettingsSection({
  repository,
}: {
  repository: Repository;
  pluginMetadata: RepositoryPlugin | undefined;
}) {
  const [visibility, setVisibility] = useState<RepositoryVisibility>(repository.visibility);
  const updateRepository = useUpdateRepository();
  useErrorToast("Repository not saved", updateRepository.error);

  useEffect(() => {
    setVisibility(repository.visibility);
  }, [repository]);

  async function savePypiConfig() {
    updateRepository.mutate({
      name: repository.name,
      input: {
        visibility,
        config: repository.config,
      },
    });
  }

  return (
    <div className="grid gap-3">
      <label className="grid gap-2">
        <span className="text-sm font-medium">Visibility</span>
        <VisibilitySelect value={visibility} onChange={setVisibility} />
      </label>
      <Button onClick={savePypiConfig} disabled={updateRepository.isPending}>
        <Save className="mr-2 h-4 w-4" />
        Save repository
      </Button>
    </div>
  );
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
      <details className="min-w-0">
        <summary className="cursor-pointer text-sm font-medium">twine upload</summary>
        <CodeBlock
          className="mt-2 max-h-64 max-w-full whitespace-pre-wrap break-words"
          language="shell"
          code={pypiUploadCommandText(repository)}
        />
      </details>
      {clientInfo.isError && <ErrorState title="PyPI client setup unavailable" error={clientInfo.error} />}
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

  if (projects.isError) {
    return <ErrorState title="PyPI projects unavailable" error={projects.error} />;
  }
  if (!projects.data) {
    return <p className="text-sm text-muted-foreground">Loading...</p>;
  }
  if (projects.data.length === 0) {
    return <EmptyState message="No projects published yet" />;
  }

  return (
    <div className="grid gap-4">
      {projects.data.map((project) => (
        <div key={project.name} className="grid gap-2">
          <h4 className="text-sm font-medium">{project.name}</h4>
          <ul className="grid gap-1">
            {project.files.map((file) => (
              <li key={file.filename} className="flex flex-wrap items-center gap-2 text-xs">
                <span className={file.yanked === undefined ? "" : "text-muted-foreground line-through"}>
                  {file.filename}
                </span>
                {file.yanked !== undefined && (
                  <Badge variant="warning">
                    {file.yanked === "" ? "yanked" : `yanked: ${file.yanked}`}
                  </Badge>
                )}
                {file.yanked === undefined ? (
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
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}

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
