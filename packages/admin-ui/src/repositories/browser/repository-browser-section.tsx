import { ExternalLink, File, Folder, Trash2, UploadCloud } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useDeleteRepositoryObject, useRepositoryArtifacts, useRepositoryObjectDetail, useRepositoryObjects } from "../../api/hooks";
import type { RepositoryArtifact, RepositoryObjectDetail } from "../../api/schemas";
import { Button } from "../../components/ui/button";
import { CopyToClipboardButton } from "../../components/ui/copy-to-clipboard-button";
import { DestructiveActionDialog } from "../../components/ui/destructive-action-dialog";
import { useToast } from "../../components/ui/toast";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "../../components/ui/dialog";
import { ErrorState } from "../../pages/shared";
import { getRepositoryPublishPlugin } from "../plugins/repository-ui-plugins";
import type { RepositoryDetailSectionProps } from "../plugins/repository-ui-plugin-types";
import {
  repositoryBrowserBreadcrumbs,
  repositoryBrowserDrawerBodyClass,
  repositoryBrowserLayoutClasses,
  repositoryBrowserObjectDeleteDialogContent,
  repositoryBrowserParentPrefix,
  repositoryBrowserRows,
  type RepositoryBrowserRow,
} from "./repository-browser-model";
import {
  type RepositoryBrowserUploadOverlay as RepositoryBrowserUploadOverlayModel,
  repositoryBrowserUploadOverlayClasses,
} from "./repository-browser-upload-model";

export function RepositoryBrowserSection({
  repository,
}: RepositoryDetailSectionProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [prefix, setPrefix] = useState("");
  const [selectedObjectPath, setSelectedObjectPath] = useState<string>();
  const [pendingDeletePath, setPendingDeletePath] = useState<string>();
  const objects = useRepositoryObjects(repository.name, prefix);
  const objectDetail = useRepositoryObjectDetail(repository.name, selectedObjectPath);
  const artifacts = useRepositoryArtifacts(repository.name);
  const deleteObject = useDeleteRepositoryObject(repository.name);
  const toast = useToast();
  const publishPlugin = getRepositoryPublishPlugin(repository.ecosystem);
  const PreviewComponent = publishPlugin?.PreviewComponent;
  const rows = objects.data ? repositoryBrowserRows(objects.data) : [];
  const layout = repositoryBrowserLayoutClasses();
  const drawerBodyClass = repositoryBrowserDrawerBodyClass();
  const deleteDialogContent = pendingDeletePath
    ? repositoryBrowserObjectDeleteDialogContent(pendingDeletePath)
    : undefined;
  const requestedObjectPath = searchParams.get("object");

  useEffect(() => {
    if (!requestedObjectPath) return;
    setPrefix(repositoryBrowserParentPrefix(requestedObjectPath));
    setSelectedObjectPath(requestedObjectPath);
  }, [requestedObjectPath]);

  function closeDeleteDialog() {
    if (deleteObject.isPending) return;
    setPendingDeletePath(undefined);
    deleteObject.reset();
  }

  function confirmDeleteObject() {
    if (!pendingDeletePath) return;
    const deletedPath = pendingDeletePath;
    deleteObject.mutate(deletedPath, {
      onSuccess: () => {
        if (selectedObjectPath === deletedPath) {
          clearSelectedObjectPath();
        }
        setPendingDeletePath(undefined);
        toast.notify({
          title: "Object deleted",
          description: deletedPath,
        });
      },
    });
  }

  function clearSelectedObjectPath() {
    setSelectedObjectPath(undefined);
    if (!searchParams.has("object")) return;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("object");
      return next;
    });
  }

  function openObject(path: string) {
    setSelectedObjectPath(path);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("object", path);
      return next;
    });
  }

  function openDirectory(path: string) {
    setPrefix(path);
    if (!searchParams.has("object")) return;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("object");
      return next;
    });
  }

  return (
    <div className="relative grid min-h-0 gap-3">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <RepositoryBrowserBreadcrumbs
          repositoryName={repository.name}
          prefix={prefix}
          onPrefixChange={setPrefix}
        />
      </div>

      <Dialog open={Boolean(selectedObjectPath)} onOpenChange={(open) => {
        if (!open) {
          clearSelectedObjectPath();
        }
      }}>
        <DialogContent className="content-start grid-rows-[auto_minmax(0,1fr)] bottom-0 left-0 top-auto max-h-[88dvh] w-full translate-x-0 translate-y-0 overflow-hidden rounded-b-none sm:bottom-auto sm:left-auto sm:right-0 sm:top-0 sm:h-dvh sm:max-h-none sm:w-[min(92vw,440px)] sm:translate-x-0 sm:translate-y-0 sm:rounded-l-lg sm:rounded-r-none">
          <div className="grid gap-1.5">
            <DialogTitle>Object detail</DialogTitle>
          </div>
          <div className={drawerBodyClass}>
            {objectDetail.isLoading && <p className="text-sm text-muted-foreground">Loading object detail...</p>}
            {objectDetail.isError && <ErrorState title="Object detail unavailable" error={objectDetail.error} />}
            {objectDetail.data && (
              <RepositoryObjectDetailPanel
                detail={objectDetail.data}
                relatedArtifacts={(artifacts.data?.artifacts ?? []).filter((artifact) => artifact.objectKeys.includes(objectDetail.data.objectKey))}
                deleting={deleteObject.variables === objectDetail.data.path}
                onDelete={() => setPendingDeletePath(objectDetail.data.path)}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {deleteDialogContent && (
        <DestructiveActionDialog
          open={Boolean(pendingDeletePath)}
          title={deleteDialogContent.title}
          description={deleteDialogContent.description}
          confirmLabel={deleteDialogContent.confirmLabel}
          pendingLabel={deleteDialogContent.pendingLabel}
          confirmationText={deleteDialogContent.confirmationText}
          pending={deleteObject.isPending}
          error={deleteObject.isError ? deleteObject.error : undefined}
          onOpenChange={(open) => {
            if (!open) {
              closeDeleteDialog();
            }
          }}
          onConfirm={confirmDeleteObject}
        />
      )}

      <div className={layout.frame}>
        {objects.isLoading && <div className={layout.loading}>Loading objects...</div>}
        {objects.isError && <div className={layout.error}><ErrorState title="Repository objects unavailable" error={objects.error} /></div>}
        {!objects.isLoading && !objects.isError && rows.length === 0 && (
          <div className={layout.empty}>
            <div className={layout.emptyPanel}>
              {PreviewComponent ? "No objects here. Use Publish artifact or drop files on this page." : "No repository objects at this path."}
            </div>
          </div>
        )}
        {!objects.isLoading && !objects.isError && rows.length > 0 && (
          <RepositoryBrowserTable
            rows={rows}
            deletingPath={deleteObject.variables}
            onOpenDirectory={openDirectory}
            onOpenObject={openObject}
            onDeleteObject={setPendingDeletePath}
          />
        )}
      </div>

    </div>
  );
}

export function RepositoryBrowserUploadOverlay({
  overlay,
}: {
  overlay: RepositoryBrowserUploadOverlayModel;
}) {
  const classes = repositoryBrowserUploadOverlayClasses(overlay.tone);
  return (
    <div className={classes.backdrop}>
      <div className={classes.panel}>
        <div className={classes.content}>
          <UploadCloud className="h-8 w-8" />
          <div className="text-base font-semibold">{overlay.title}</div>
          <div className="text-sm text-muted-foreground">{overlay.description}</div>
        </div>
      </div>
    </div>
  );
}

function RepositoryBrowserBreadcrumbs({
  repositoryName,
  prefix,
  onPrefixChange,
}: {
  repositoryName: string;
  prefix: string;
  onPrefixChange: (prefix: string) => void;
}) {
  return (
    <nav className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
      {repositoryBrowserBreadcrumbs(repositoryName, prefix).map((breadcrumb, index) => (
        <span key={breadcrumb.prefix || "__root"} className="flex items-center gap-1">
          {index > 0 && <span className="text-muted-foreground">/</span>}
          <button
            type="button"
            className="rounded px-1.5 py-1 font-medium text-foreground hover:bg-muted"
            onClick={() => onPrefixChange(breadcrumb.prefix)}
          >
            {breadcrumb.label}
          </button>
        </span>
      ))}
    </nav>
  );
}

function RepositoryBrowserTable({
  rows,
  deletingPath,
  onOpenDirectory,
  onOpenObject,
  onDeleteObject,
}: {
  rows: RepositoryBrowserRow[];
  deletingPath: string | undefined;
  onOpenDirectory: (prefix: string) => void;
  onOpenObject: (path: string) => void;
  onDeleteObject: (path: string) => void;
}) {
  return (
    <div className="max-h-[36rem] overflow-auto">
      <table className="w-full min-w-[40rem] table-fixed text-sm">
        <thead className="sticky top-0 bg-panel text-left text-xs text-muted-foreground">
          <tr>
            <th className="w-[45%] px-3 py-2 font-medium">Name</th>
            <th className="w-[25%] px-3 py-2 font-medium">Type</th>
            <th className="w-[15%] px-3 py-2 font-medium">Size</th>
            <th className="w-[12%] px-3 py-2 font-medium">Path</th>
            <th className="w-[3rem] px-3 py-2 font-medium" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.kind}:${row.path}`} className="border-t border-border">
              <td className="min-w-0 px-3 py-2">
                <RepositoryBrowserNameCell
                  row={row}
                  onOpenDirectory={onOpenDirectory}
                  onOpenObject={onOpenObject}
                />
              </td>
              <td className="truncate px-3 py-2 text-muted-foreground">{row.contentType}</td>
              <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{row.sizeLabel}</td>
              <td className="truncate px-3 py-2 text-xs text-muted-foreground">{row.path}</td>
              <td className="px-3 py-2 text-right">
                {row.kind === "object" && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    aria-label={`Delete ${row.path}`}
                    title={`Delete ${row.path}`}
                    disabled={deletingPath === row.path}
                    onClick={() => onDeleteObject(row.path)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RepositoryBrowserNameCell({
  row,
  onOpenDirectory,
  onOpenObject,
}: {
  row: RepositoryBrowserRow;
  onOpenDirectory: (prefix: string) => void;
  onOpenObject: (path: string) => void;
}) {
  const icon = row.kind === "directory"
    ? <Folder className="h-4 w-4 text-primary" />
    : <File className="h-4 w-4 text-muted-foreground" />;
  if (row.kind === "directory") {
    return (
      <button
        type="button"
        className="flex min-w-0 items-center gap-2 rounded px-1 py-0.5 text-left font-medium hover:bg-muted"
        onClick={() => onOpenDirectory(row.path)}
      >
        {icon}
        <span className="truncate">{row.name}</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      className="flex min-w-0 items-center gap-2 rounded px-1 py-0.5 text-left font-medium hover:bg-muted"
      onClick={() => onOpenObject(row.path)}
    >
      {icon}
      <span className="truncate">{row.name}</span>
    </button>
  );
}

function RepositoryObjectDetailPanel({
  detail,
  relatedArtifacts,
  deleting,
  onDelete,
}: {
  detail: RepositoryObjectDetail;
  relatedArtifacts: RepositoryArtifact[];
  deleting: boolean;
  onDelete: () => void;
}) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <div className="truncate text-sm font-semibold">{detail.name}</div>
        <div className="break-all text-xs text-muted-foreground">{detail.path}</div>
      </div>
      <dl className="grid gap-2 text-sm">
        <RepositoryObjectDetailItem label="Object key" value={detail.objectKey} />
        <RepositoryObjectDetailItem label="Content type" value={detail.contentType ?? "-"} />
        <RepositoryObjectDetailItem label="Size" value={detail.size === undefined ? "-" : `${detail.size} B`} />
        <RepositoryObjectDetailItem label="ETag" value={detail.etag ?? "-"} />
        <RepositoryObjectDetailItem label="Repository URL" value={detail.repositoryUrl} />
      </dl>
      <div className="flex flex-wrap justify-end gap-2">
        <CopyToClipboardButton type="button" variant="outline" text={detail.repositoryUrl} label="Copy URL" copiedLabel="Copied" />
        <Button type="button" variant="outline" onClick={() => window.open(detail.repositoryUrl, "_blank", "noopener,noreferrer")}>
          <ExternalLink className="mr-2 h-4 w-4" />
          Open
        </Button>
        <Button type="button" variant="destructive" disabled={deleting} onClick={onDelete}>
          <Trash2 className="mr-2 h-4 w-4" />
          {deleting ? "Deleting..." : "Delete"}
        </Button>
      </div>
      {relatedArtifacts.length > 0 && (
        <div className="grid gap-2">
          <div className="text-xs font-medium text-muted-foreground">Related artifacts</div>
          <ul className="grid gap-1 text-xs">
            {relatedArtifacts.map((artifact) => (
              <li key={artifact.id} className="rounded bg-muted px-2 py-1">
                <div className="truncate font-medium">{artifact.summary}</div>
                <div className="truncate text-muted-foreground">{artifact.identity}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function RepositoryObjectDetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 rounded-md border border-border bg-background/40 p-2">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="break-all text-xs">{value}</dd>
    </div>
  );
}
