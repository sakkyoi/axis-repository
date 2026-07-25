import { ArrowLeft, History, PackagePlus, Settings } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useRepositories, useRepositoryPlugins } from "../api/hooks";
import type { Repository, RepositoryPlugin } from "../api/schemas";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { ADMIN_UI_PATHS, repositorySettingsPath, repositoryWorkspacePath } from "../navigation";
import { repositorySettingsSectionsFor, repositoryWorkspaceSectionsFor } from "../repositories/plugins/repository-detail-plugins";
import { PublishSessionsSection, RepositoryDetailSections } from "../repositories/detail/repository-detail-shared";
import type { RepositoryDetailSection } from "../repositories/plugins/repository-ui-plugin-types";
import { repositoryDetailBodyClass } from "../repositories/detail/repository-page-model";
import { EmptyState, ErrorState, PageHeader } from "./shared";
import { getRepositoryPublishPlugin } from "../repositories/plugins/repository-ui-plugins";
import {
  filesFromFileList,
  repositoryBrowserAcceptedPublishFiles,
} from "../repositories/browser/repository-browser-upload-model";
import {
  repositoryBrowserActivityDrawerContentClass,
  repositoryBrowserDrawerBodyClass,
  repositoryBrowserPublishDrawerContentClass,
} from "../repositories/browser/repository-browser-model";
import { repositoryWorkspaceActions } from "../repositories/workspace/repository-workspace-actions-model";

export function RepositoryWorkspacePage() {
  const navigate = useNavigate();
  const { name } = useParams<{ name: string }>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [publishFileError, setPublishFileError] = useState("");
  const repositories = useRepositories();
  const repositoryPlugins = useRepositoryPlugins();
  const repository = useRepositoryByName(repositories.data, name);
  const pluginMetadata = repositoryPlugins.data?.find((plugin) => plugin.ecosystem === repository?.ecosystem);
  const publishPlugin = repository ? getRepositoryPublishPlugin(repository.ecosystem) : undefined;
  const PreviewComponent = publishPlugin?.PreviewComponent;

  function handlePublishFiles(files: File[]) {
    if (!repository || files.length === 0 || !PreviewComponent) return;
    const { accepted, rejected } = repositoryBrowserAcceptedPublishFiles({
      files,
      ...(publishPlugin?.isAcceptedFile ? { isAcceptedFile: publishPlugin.isAcceptedFile } : {}),
    });
    setSelectedFiles(accepted);
    setPublishFileError(
      accepted.length === 0 && rejected.length > 0
        ? `This repository accepts ${publishPlugin?.acceptedFileDescription ?? "supported artifact files"}.`
        : "",
    );
    setPublishOpen(true);
  }

  function closePublishPreview() {
    setPublishOpen(false);
    setSelectedFiles([]);
    setPublishFileError("");
  }

  return (
    <>
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
            {repositoryWorkspaceActions({ canPublish: Boolean(PreviewComponent) }).map((action) => {
              if (action.id === "activity") {
                return (
                  <Button key={action.id} type="button" variant="outline" onClick={() => setActivityOpen(true)}>
                    <History className="mr-2 h-4 w-4" />
                    {action.label}
                  </Button>
                );
              }
              return (
                <Button key={action.id} type="button" onClick={() => fileInputRef.current?.click()}>
                  <PackagePlus className="mr-2 h-4 w-4" />
                  {action.label}
                </Button>
              );
            })}
            {PreviewComponent && (
              <input
                ref={fileInputRef}
                type="file"
                accept={publishPlugin?.accept}
                className="hidden"
                onChange={(event) => {
                  handlePublishFiles(filesFromFileList(event.currentTarget.files));
                  event.currentTarget.value = "";
                }}
              />
            )}
          </div>
        ) : undefined}
        sections={repository ? repositoryWorkspaceSectionsFor(repository.ecosystem) : []}
        {...(repository && PreviewComponent ? { onPublishFiles: handlePublishFiles } : {})}
      />
      {repository && (
        <>
          <Dialog
            open={publishOpen}
            onOpenChange={(open) => {
              if (open) {
                setPublishOpen(true);
                return;
              }
              closePublishPreview();
            }}
          >
            <DialogContent className={repositoryBrowserPublishDrawerContentClass()}>
              <DialogHeader>
                <DialogTitle>{publishPlugin?.title ?? "Publish artifact"}</DialogTitle>
              </DialogHeader>
              <div className={repositoryBrowserDrawerBodyClass()}>
                {publishFileError ? (
                  <div className="grid gap-3">
                    <ErrorState title="Unsupported artifact" error={publishFileError} />
                    <div className="flex justify-end">
                      <Button type="button" variant="outline" onClick={closePublishPreview}>
                        Close
                      </Button>
                    </div>
                  </div>
                ) : PreviewComponent && (
                  <PreviewComponent
                    repository={repository}
                    pluginMetadata={pluginMetadata}
                    droppedFiles={selectedFiles}
                    onCancel={closePublishPreview}
                    onPublished={closePublishPreview}
                  />
                )}
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={activityOpen} onOpenChange={setActivityOpen}>
            <DialogContent className={repositoryBrowserActivityDrawerContentClass()}>
              <DialogHeader>
                <DialogTitle>Activity</DialogTitle>
              </DialogHeader>
              <div className={repositoryBrowserDrawerBodyClass()}>
                <PublishSessionsSection
                  repository={repository}
                  pluginMetadata={pluginMetadata}
                  hideTitle
                  {...(publishPlugin?.artifactSummary ? { artifactSummary: publishPlugin.artifactSummary } : {})}
                  {...(publishPlugin?.SessionDetailComponent ? { SessionDetailComponent: publishPlugin.SessionDetailComponent } : {})}
                />
              </div>
            </DialogContent>
          </Dialog>
        </>
      )}
    </>
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
  onPublishFiles,
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
  onPublishFiles?: (files: File[]) => void;
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
              <RepositoryDetailSections
                repository={repository}
                pluginMetadata={pluginMetadata}
                sections={sections}
                {...(onPublishFiles ? { onPublishFiles } : {})}
              />
            )}
          </div>
        )}
      </div>
    </section>
  );
}
