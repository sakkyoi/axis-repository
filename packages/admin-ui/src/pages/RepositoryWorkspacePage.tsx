import { ArrowLeft, History, PackagePlus, Settings, Trash2 } from "lucide-react";
import type { DragEvent } from "react";
import { useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useDeleteRepository, useRepositories, useRepositoryPlugins } from "../api/hooks";
import type { Repository, RepositoryPlugin } from "../api/schemas";
import { Button } from "../components/ui/button";
import { DestructiveActionDialog } from "../components/ui/destructive-action-dialog";
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
import { repositoryDeleteDialogContent, repositoryDetailBodyClass } from "../repositories/detail/repository-page-model";
import { EmptyState, ErrorState, PageShell } from "./shared";
import { getRepositoryPublishPlugin } from "../repositories/plugins/repository-ui-plugins";
import {
  filesFromFileList,
  repositoryBrowserAcceptedPublishFiles,
  repositoryBrowserUploadOverlay,
  repositoryWorkspaceDropTargetClass,
} from "../repositories/browser/repository-browser-upload-model";
import {
  repositoryBrowserActivityDrawerContentClass,
  repositoryBrowserDrawerBodyClass,
  repositoryBrowserPublishDrawerContentClass,
} from "../repositories/browser/repository-browser-model";
import { RepositoryBrowserUploadOverlay } from "../repositories/browser/repository-browser-section";
import { repositoryWorkspaceActions } from "../repositories/workspace/repository-workspace-actions-model";

export function RepositoryWorkspacePage() {
  const navigate = useNavigate();
  const { name } = useParams<{ name: string }>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [publishFileError, setPublishFileError] = useState("");
  const [dragDepth, setDragDepth] = useState(0);
  const repositories = useRepositories();
  const repositoryPlugins = useRepositoryPlugins();
  const repository = useRepositoryByName(repositories.data, name);
  const pluginMetadata = repositoryPlugins.data?.find((plugin) => plugin.ecosystem === repository?.ecosystem);
  const publishPlugin = repository ? getRepositoryPublishPlugin(repository.ecosystem) : undefined;
  const PreviewComponent = publishPlugin?.PreviewComponent;
  const overlay = repository
    ? repositoryBrowserUploadOverlay({
        repositoryName: repository.name,
        canPublish: Boolean(PreviewComponent),
        isDraggingFiles: dragDepth > 0,
      })
    : undefined;

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

  function onDragEnter(event: DragEvent<HTMLElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    setDragDepth((current) => current + 1);
  }

  function onDragLeave(event: DragEvent<HTMLElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    setDragDepth((current) => Math.max(0, current - 1));
  }

  function onDragOver(event: DragEvent<HTMLElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragDepth(0);
    handlePublishFiles(filesFromFileList(event.dataTransfer.files));
  }

  return (
    <section
      className={repositoryWorkspaceDropTargetClass()}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
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
      {overlay && <RepositoryBrowserUploadOverlay overlay={overlay} />}
    </section>
  );
}

export function RepositorySettingsPage() {
  const navigate = useNavigate();
  const { name } = useParams<{ name: string }>();
  const repositories = useRepositories();
  const repositoryPlugins = useRepositoryPlugins();
  const repository = useRepositoryByName(repositories.data, name);
  const pluginMetadata = repositoryPlugins.data?.find((plugin) => plugin.ecosystem === repository?.ecosystem);
  const deleteRepository = useDeleteRepository();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const deleteDialogContent = repository ? repositoryDeleteDialogContent(repository.name) : undefined;

  function closeDeleteDialog() {
    if (deleteRepository.isPending) return;
    setDeleteDialogOpen(false);
    deleteRepository.reset();
  }

  function confirmDeleteRepository() {
    if (!repository) return;
    deleteRepository.mutate(repository.name, {
      onSuccess: () => {
        setDeleteDialogOpen(false);
        navigate(ADMIN_UI_PATHS.repositories);
      },
    });
  }

  return (
    <>
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
        afterSections={repository ? (
          <section className="grid gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-4">
            <div>
              <h2 className="text-sm font-semibold text-destructive">Danger zone</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Delete this repository and all repository-owned content.
              </p>
            </div>
            <div>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={deleteRepository.isPending}
                onClick={() => setDeleteDialogOpen(true)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete repository
              </Button>
            </div>
          </section>
        ) : undefined}
      />
      {deleteDialogContent && (
        <DestructiveActionDialog
          open={deleteDialogOpen}
          title={deleteDialogContent.title}
          description={deleteDialogContent.description}
          confirmLabel={deleteDialogContent.confirmLabel}
          pendingLabel={deleteDialogContent.pendingLabel}
          confirmationText={deleteDialogContent.confirmationText}
          pending={deleteRepository.isPending}
          error={deleteRepository.isError ? deleteRepository.error : undefined}
          onOpenChange={(open) => {
            if (!open) {
              closeDeleteDialog();
            }
          }}
          onConfirm={confirmDeleteRepository}
        />
      )}
    </>
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
  afterSections,
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
  afterSections?: React.ReactNode;
}) {
  return (
    <PageShell
      title={title}
      description={description}
      action={action}
      bodyClassName="min-h-0 overflow-hidden rounded-lg border border-border bg-panel p-0"
    >
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
            {afterSections}
          </div>
        )}
    </PageShell>
  );
}
