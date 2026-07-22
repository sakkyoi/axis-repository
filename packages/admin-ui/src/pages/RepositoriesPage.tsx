import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { useRepositories } from "../api/hooks";
import type { Repository } from "../api/schemas";
import { ADMIN_UI_PATHS } from "../navigation";
import { repositoryRowStateClass } from "../repository-page-model";
import { GenericRepositoryDetail, getRepositoryDetailPlugin } from "../repository-detail-plugins";
import { EmptyState, ErrorState, PageHeader, formatDate } from "./shared";

export function RepositoriesPage() {
  const navigate = useNavigate();
  const repositories = useRepositories();
  const [selectedName, setSelectedName] = useState<string>();
  const selected = useMemo(
    () => repositories.data?.find((repository) => repository.name === selectedName),
    [repositories.data, selectedName],
  );

  return (
    <section className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
      <PageHeader
        title="Repositories"
        description="Manage repository visibility, config, and client setup hints."
        action={(
          <div className="flex items-center gap-2">
            <Button type="button" onClick={() => navigate(ADMIN_UI_PATHS.newRepository)}>
              <Plus className="mr-2 h-4 w-4" />
              Create repository
            </Button>
          </div>
        )}
      />
      <div className="min-h-0">
        {repositories.isError && <ErrorState error={repositories.error} />}
        {repositories.isLoading && <div className="text-sm text-muted-foreground">Loading repositories...</div>}
        {repositories.data && (
          <div className="grid h-full min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,420px)]">
            <div className="min-h-0 min-w-0 overflow-auto rounded-lg border border-border bg-panel">
              {repositories.data.length === 0 ? (
                <div className="p-4">
                  <EmptyState message="No repositories have been created." />
                </div>
              ) : (
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 bg-muted text-left text-xs uppercase text-muted-foreground">
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
                      className={`cursor-pointer border-t border-border ${repositoryRowStateClass(repository.name, selectedName)}`}
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
              )}
            </div>
            {selected ? <RepositoryDetail repository={selected} /> : <RepositoryDetailEmptyState />}
          </div>
        )}
      </div>
    </section>
  );
}

function RepositoryDetailEmptyState() {
  return (
    <aside className="grid min-h-0 min-w-0 place-items-center rounded-lg border border-dashed border-border bg-panel p-6">
      <div className="max-w-xs text-center">
        <h2 className="text-sm font-semibold">Select a repository</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose an item from the repository list to inspect config, signing keys, and client setup.
        </p>
      </div>
    </aside>
  );
}

function RepositoryDetail({ repository }: { repository: Repository }) {
  const plugin = getRepositoryDetailPlugin(repository.ecosystem);
  const Detail = plugin?.Detail ?? GenericRepositoryDetail;

  return (
    <aside className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg border border-border bg-panel">
      <div className="sticky top-0 z-10 border-b border-border bg-panel p-4">
        <h2 className="text-base font-semibold">{repository.name}</h2>
        <p className="text-sm text-muted-foreground">{repository.ecosystem}</p>
      </div>
      <div className="grid min-h-0 gap-4 overflow-y-auto overflow-x-hidden p-4">
        <Detail repository={repository} />
      </div>
    </aside>
  );
}
