import { useMemo, useState } from "react";
import { ExternalLink, Save } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Textarea } from "../components/ui/textarea";
import { useAptInstallInstructions, useRepositories, useUpdateRepository } from "../api/hooks";
import type { Repository, RepositoryVisibility } from "../api/schemas";
import { asJson, EmptyState, ErrorState, PageHeader, formatDate } from "./shared";

export function RepositoriesPage() {
  const repositories = useRepositories();
  const [selectedName, setSelectedName] = useState<string>();
  const selected = useMemo(
    () => repositories.data?.find((repository) => repository.name === selectedName) ?? repositories.data?.[0],
    [repositories.data, selectedName],
  );

  return (
    <section>
      <PageHeader title="Repositories" description="Manage repository visibility, config, and client setup hints." />
      {repositories.isError && <ErrorState error={repositories.error} />}
      {repositories.isLoading && <div className="text-sm text-muted-foreground">Loading repositories...</div>}
      {repositories.data && repositories.data.length === 0 && <EmptyState message="No repositories have been created." />}
      {repositories.data && repositories.data.length > 0 && (
        <div className="grid grid-cols-[minmax(0,1fr)_420px] gap-5">
          <div className="overflow-hidden rounded-lg border border-border bg-panel">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Ecosystem</th>
                  <th className="px-3 py-2">Visibility</th>
                  <th className="px-3 py-2">Updated</th>
                </tr>
              </thead>
              <tbody>
                {repositories.data.map((repository) => (
                  <tr
                    key={repository.id}
                    className="cursor-pointer border-t border-border hover:bg-muted/60"
                    onClick={() => setSelectedName(repository.name)}
                  >
                    <td className="px-3 py-2 font-medium">{repository.name}</td>
                    <td className="px-3 py-2">{repository.ecosystem}</td>
                    <td className="px-3 py-2">
                      <Badge variant={repository.visibility === "public" ? "success" : "default"}>
                        {repository.visibility}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{formatDate(repository.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selected && <RepositoryDetail repository={selected} />}
        </div>
      )}
    </section>
  );
}

function RepositoryDetail({ repository }: { repository: Repository }) {
  const [visibility, setVisibility] = useState<RepositoryVisibility>(repository.visibility);
  const [config, setConfig] = useState(asJson(repository.config));
  const [configError, setConfigError] = useState("");
  const updateRepository = useUpdateRepository();
  const install = useAptInstallInstructions(repository.name, repository.ecosystem === "apt");

  async function save() {
    let parsedConfig: Record<string, unknown>;
    try {
      parsedConfig = JSON.parse(config) as Record<string, unknown>;
      setConfigError("");
    } catch (error) {
      setConfigError(error instanceof Error ? error.message : "Invalid JSON");
      return;
    }

    updateRepository.mutate({
      name: repository.name,
      input: {
        visibility,
        config: parsedConfig,
      },
    });
  }

  return (
    <aside className="grid gap-4 rounded-lg border border-border bg-panel p-4">
      <div>
        <h2 className="text-base font-semibold">{repository.name}</h2>
        <p className="text-sm text-muted-foreground">{repository.ecosystem}</p>
      </div>
      <label className="grid gap-2">
        <span className="text-sm font-medium">Visibility</span>
        <Select value={visibility} onValueChange={(value) => setVisibility(value as RepositoryVisibility)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="private">private</SelectItem>
            <SelectItem value="public">public</SelectItem>
          </SelectContent>
        </Select>
      </label>
      <label className="grid gap-2">
        <span className="text-sm font-medium">Config JSON</span>
        <Textarea value={config} onChange={(event) => setConfig(event.target.value)} />
      </label>
      {configError && <ErrorState error={configError} />}
      <Button onClick={save} disabled={updateRepository.isPending}>
        <Save className="mr-2 h-4 w-4" />
        Save repository
      </Button>
      {updateRepository.isError && <ErrorState error={updateRepository.error} />}
      {repository.ecosystem === "apt" && (
        <div className="grid gap-3 border-t border-border pt-4">
          <h3 className="text-sm font-semibold">APT client setup</h3>
          <a className="inline-flex items-center gap-2 text-sm text-blue-700" href={`/repositories/${repository.name}/apt/key.gpg`}>
            key.gpg <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <a className="inline-flex items-center gap-2 text-sm text-blue-700" href={`/repositories/${repository.name}/apt/source`}>
            source <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <a className="inline-flex items-center gap-2 text-sm text-blue-700" href={`/repositories/${repository.name}/apt/install`}>
            install <ExternalLink className="h-3.5 w-3.5" />
          </a>
          {install.data && (
            <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">{asJson(install.data)}</pre>
          )}
        </div>
      )}
    </aside>
  );
}
