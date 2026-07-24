import { ArrowLeft, Settings } from "lucide-react";
import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useRepositories, useRepositoryPlugins } from "../api/hooks";
import type { Repository, RepositoryPlugin } from "../api/schemas";
import { Button } from "../components/ui/button";
import { ADMIN_UI_PATHS, repositorySettingsPath, repositoryWorkspacePath } from "../navigation";
import { repositorySettingsSectionsFor, repositoryWorkspaceSectionsFor } from "../repositories/plugins/repository-detail-plugins";
import { RepositoryDetailSections } from "../repositories/detail/repository-detail-shared";
import type { RepositoryDetailSection } from "../repositories/plugins/repository-ui-plugin-types";
import { repositoryDetailBodyClass } from "../repositories/detail/repository-page-model";
import { EmptyState, ErrorState, PageHeader } from "./shared";

export function RepositoryWorkspacePage() {
  const navigate = useNavigate();
  const { name } = useParams<{ name: string }>();
  const repositories = useRepositories();
  const repositoryPlugins = useRepositoryPlugins();
  const repository = useRepositoryByName(repositories.data, name);
  const pluginMetadata = repositoryPlugins.data?.find((plugin) => plugin.ecosystem === repository?.ecosystem);

  return (
    <RepositoryPageShell
      repositoryName={name}
      repository={repository}
      pluginMetadata={pluginMetadata}
      isLoading={repositories.isLoading}
      error={repositories.isError ? repositories.error : undefined}
      title={repository?.name ?? "Repository"}
      description="Publish artifacts and inspect client setup for this repository."
      action={repository ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => navigate(ADMIN_UI_PATHS.repositories)}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Repositories
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate(repositorySettingsPath(repository.name))}>
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </Button>
        </div>
      ) : undefined}
      sections={repository ? repositoryWorkspaceSectionsFor(repository.ecosystem) : []}
    />
  );
}

export function RepositorySettingsPage() {
  const navigate = useNavigate();
  const { name } = useParams<{ name: string }>();
  const repositories = useRepositories();
  const repositoryPlugins = useRepositoryPlugins();
  const repository = useRepositoryByName(repositories.data, name);
  const pluginMetadata = repositoryPlugins.data?.find((plugin) => plugin.ecosystem === repository?.ecosystem);

  return (
    <RepositoryPageShell
      repositoryName={name}
      repository={repository}
      pluginMetadata={pluginMetadata}
      isLoading={repositories.isLoading}
      error={repositories.isError ? repositories.error : undefined}
      title={repository ? `${repository.name} settings` : "Repository settings"}
      description="Manage repository visibility, config, and plugin-owned resources."
      action={repository ? (
        <Button type="button" variant="outline" onClick={() => navigate(repositoryWorkspacePath(repository.name))}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Repository
        </Button>
      ) : undefined}
      sections={repository ? repositorySettingsSectionsFor(repository.ecosystem) : []}
    />
  );
}

function useRepositoryByName(repositories: Repository[] | undefined, name: string | undefined) {
  return useMemo(
    () => repositories?.find((repository) => repository.name === name),
    [repositories, name],
  );
}

function RepositoryPageShell({
  repositoryName,
  repository,
  pluginMetadata,
  isLoading,
  error,
  title,
  description,
  action,
  sections,
}: {
  repositoryName: string | undefined;
  repository: Repository | undefined;
  pluginMetadata: RepositoryPlugin | undefined;
  isLoading: boolean;
  error: unknown;
  title: string;
  description: string;
  action: React.ReactNode;
  sections: RepositoryDetailSection[];
}) {
  return (
    <section className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
      <PageHeader title={title} description={description} action={action} />
      <div className="min-h-0 overflow-hidden rounded-lg border border-border bg-panel">
        {error ? <div className="p-4"><ErrorState error={error} /></div> : null}
        {isLoading && <div className="p-4 text-sm text-muted-foreground">Loading repository...</div>}
        {!isLoading && !error && !repository && (
          <div className="p-4">
            <EmptyState message={`Repository not found${repositoryName ? `: ${repositoryName}` : "."}`} />
          </div>
        )}
        {repository && (
          <div className={repositoryDetailBodyClass()}>
            {sections.length === 0 ? (
              <EmptyState message="This repository does not expose sections for this page." />
            ) : (
              <RepositoryDetailSections repository={repository} pluginMetadata={pluginMetadata} sections={sections} />
            )}
          </div>
        )}
      </div>
    </section>
  );
}
