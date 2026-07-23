import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { useUpdateRepository } from "../../../packages/admin-ui/src/api/hooks";
import type {
  Repository,
  RepositoryPlugin,
  RepositoryVisibility,
} from "../../../packages/admin-ui/src/api/schemas";
import { Button } from "../../../packages/admin-ui/src/components/ui/button";
import { ErrorState } from "../../../packages/admin-ui/src/pages/shared";
import { VisibilitySelect } from "../../../packages/admin-ui/src/repository-detail-shared";
import { usePypiClientInfo } from "./api";

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
      {updateRepository.isError && <ErrorState error={updateRepository.error} />}
    </div>
  );
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
        <pre className="mt-2 max-h-64 max-w-full overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs">
          {clientInfo.data ? pypiInstallCommandText(repository, clientInfo.data.pipIndexUrl) : "Loading..."}
        </pre>
      </details>
      {clientInfo.isError && <ErrorState title="PyPI client setup unavailable" error={clientInfo.error} />}
    </>
  );
}
