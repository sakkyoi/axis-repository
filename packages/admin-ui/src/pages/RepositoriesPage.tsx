import { useMemo, useState } from "react";
import { ArrowRight, Plus, Settings } from "lucide-react";
import { useNavigate } from "react-router";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { useRepositories, useRepositoryPlugins } from "../api/hooks";
import type { Repository, RepositoryPlugin } from "../api/schemas";
import { ADMIN_UI_PATHS, repositorySettingsPath, repositoryWorkspacePath } from "../navigation";
import { pluginLifecycleSummary } from "../repositories/plugins/plugin-lifecycle";
import { repositorySummarySectionsFor } from "../repositories/plugins/repository-detail-plugins";
import { RepositoryDetailSections } from "../repositories/detail/repository-detail-shared";
import {
  repositoryDetailBodyClass,
  repositoryListEmptyClass,
  repositoryListEmptyPanelClass,
  repositoryRowStateClass,
  repositorySummaryItems,
} from "../repositories/detail/repository-page-model";
import { ErrorState, PageShell, formatDate } from "./shared";
import { SkeletonRows } from "../components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { useViewportWidth } from "../components/use-viewport-width";
import { DETAIL_PANE_NEEDS_PX, detailPaneFitsBeside, listDetailGridClass } from "./list-detail-model";
import { sideDrawerBodyClass, sideDrawerContentClass } from "../components/ui/side-drawer";

export function RepositoriesPage() {
  const navigate = useNavigate();
  const repositories = useRepositories();
  const repositoryPlugins = useRepositoryPlugins();
  const [selectedName, setSelectedName] = useState<string>();
  const beside = detailPaneFitsBeside(useViewportWidth(DETAIL_PANE_NEEDS_PX));
  const pluginFor = (repository: Repository) =>
    repositoryPlugins.data?.find((plugin) => plugin.ecosystem === repository.ecosystem);
  const selected = useMemo(
    () => repositories.data?.find((repository) => repository.name === selectedName),
    [repositories.data, selectedName],
  );
  const selectedPlugin = selected ? pluginFor(selected) : undefined;
  const selectedLifecycle = selectedPlugin ? pluginLifecycleSummary(selectedPlugin) : undefined;

  return (
    <PageShell
      title="Repositories"
      description="Manage repository visibility, config, and client setup hints."
      bodyClassName="min-h-0 content-stretch overflow-hidden"
      action={(
        <div className="flex items-center gap-2">
          <Button type="button" onClick={() => navigate(ADMIN_UI_PATHS.newRepository)}>
            <Plus className="mr-2 h-4 w-4" />
            Create repository
          </Button>
        </div>
      )}
    >
      {repositories.isError && <ErrorState error={repositories.error} />}
      {repositories.isLoading && (
        <div className="rounded-lg border border-border bg-panel">
          <SkeletonRows rows={5} columns={["w-48", "w-20", "w-24", "w-32"]} />
        </div>
      )}
      {repositories.data && (
        <div className={listDetailGridClass(beside)}>
          <div className="min-h-0 min-w-0 overflow-auto rounded-lg border border-border bg-panel">
            {repositories.data.length === 0 ? (
              <div className={repositoryListEmptyClass()}>
                <div className={repositoryListEmptyPanelClass()}>
                  No repositories have been created.
                </div>
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
          {beside && (selected
            ? <RepositoryDetail repository={selected} pluginMetadata={pluginFor(selected)} />
            : <RepositoryDetailEmptyState />)}
        </div>
      )}
      {/* Too narrow to sit beside the list, so it comes over it instead --
          which is how everything else in this console shows one of many. */}
      <Dialog open={!beside && Boolean(selected)} onOpenChange={(open) => {
        if (!open) setSelectedName(undefined);
      }}>
        <DialogContent className={sideDrawerContentClass()}>
          {/* Everything the framed header carried, said once. */}
          <DialogHeader>
            <div className="flex min-w-0 items-start justify-between gap-3 pr-6">
              <div className="min-w-0">
                <DialogTitle className="truncate">{selected?.name ?? "Repository"}</DialogTitle>
                {selected && <p className="text-sm text-muted-foreground">{selected.ecosystem}</p>}
              </div>
              {selectedLifecycle && (
                <Badge className="shrink-0" variant={selectedLifecycle.variant}>{selectedLifecycle.label}</Badge>
              )}
            </div>
          </DialogHeader>
          <div className={sideDrawerBodyClass()}>
            {selected && <RepositoryDetail repository={selected} pluginMetadata={pluginFor(selected)} framed={false} />}
          </div>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

function RepositoryDetailEmptyState() {
  return (
    <aside className="grid min-h-0 min-w-0 place-items-center rounded-lg border border-dashed border-border bg-panel p-6">
      <div className="max-w-xs text-center">
        <h2 className="text-sm font-semibold">Select a repository</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose an item from the repository list to inspect its summary.
        </p>
      </div>
    </aside>
  );
}

function RepositoryDetail({
  repository,
  pluginMetadata,
  framed = true,
}: {
  repository: Repository;
  pluginMetadata: RepositoryPlugin | undefined;
  /** False in a drawer, which is already the frame and already says the name. */
  framed?: boolean;
}) {
  const navigate = useNavigate();
  const lifecycle = pluginMetadata ? pluginLifecycleSummary(pluginMetadata) : undefined;
  const summaryItems = repositorySummaryItems(repository);
  const summarySections = repositorySummarySectionsFor(repository.ecosystem);

  const body = (
      <div className={repositoryDetailBodyClass(framed)}>
        <div className="grid gap-3">
          <Button type="button" onClick={() => navigate(repositoryWorkspacePath(repository.name))}>
            <ArrowRight className="mr-2 h-4 w-4" />
            Open repository
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate(repositorySettingsPath(repository.name))}>
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </Button>
        </div>
        {summarySections.length > 0 && (
          <div className="grid gap-3 rounded-md border border-border bg-background/40 p-3">
            <RepositoryDetailSections
              repository={repository}
              pluginMetadata={pluginMetadata}
              sections={summarySections}
            />
          </div>
        )}
        <div className="grid gap-3">
          {summaryItems.map(([label, value]) => (
            <div key={label} className="grid gap-1 rounded-md border border-border bg-background/40 p-3">
              <span className="text-xs font-medium uppercase text-muted-foreground">{label}</span>
              <span className="break-all text-sm">
                {label === "Created" || label === "Updated" ? formatDate(value) : value}
              </span>
            </div>
          ))}
          {lifecycle && <p className="text-sm text-muted-foreground">{lifecycle.description}</p>}
        </div>
      </div>
  );

  if (!framed) {
    return body;
  }

  return (
    <aside className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg border border-border bg-panel">
      <div className="sticky top-0 z-10 border-b border-border bg-panel p-4">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">{repository.name}</h2>
            <p className="text-sm text-muted-foreground">{repository.ecosystem}</p>
          </div>
          {lifecycle && <Badge variant={lifecycle.variant}>{lifecycle.label}</Badge>}
        </div>
      </div>
      {body}
    </aside>
  );
}
