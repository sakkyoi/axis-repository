import { File, Folder, PackagePlus, UploadCloud } from "lucide-react";
import type { DragEvent } from "react";
import { useRef, useState } from "react";
import { useRepositoryObjects } from "../../api/hooks";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { ErrorState } from "../../pages/shared";
import { PublishSessionsSection } from "../detail/repository-detail-shared";
import { getRepositoryPublishPlugin } from "../plugins/repository-ui-plugins";
import type { RepositoryDetailSectionProps } from "../plugins/repository-ui-plugin-types";
import {
  repositoryBrowserBreadcrumbs,
  repositoryBrowserLayoutClasses,
  repositoryBrowserPublishDrawerContentClass,
  repositoryBrowserRows,
  type RepositoryBrowserRow,
} from "./repository-browser-model";
import {
  filesFromFileList,
  repositoryBrowserUploadOverlay,
  repositoryBrowserUploadOverlayClasses,
} from "./repository-browser-upload-model";

export function RepositoryBrowserSection({
  repository,
  pluginMetadata,
}: RepositoryDetailSectionProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [prefix, setPrefix] = useState("");
  const [publishOpen, setPublishOpen] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [dragDepth, setDragDepth] = useState(0);
  const objects = useRepositoryObjects(repository.name, prefix);
  const publishPlugin = getRepositoryPublishPlugin(repository.ecosystem);
  const PreviewComponent = publishPlugin?.PreviewComponent;
  const rows = objects.data ? repositoryBrowserRows(objects.data) : [];
  const layout = repositoryBrowserLayoutClasses();
  const publishDrawerContentClass = repositoryBrowserPublishDrawerContentClass();
  const overlay = repositoryBrowserUploadOverlay({
    repositoryName: repository.name,
    canPublish: Boolean(PreviewComponent),
    isDraggingFiles: dragDepth > 0,
  });

  function handleFiles(files: File[]) {
    if (files.length === 0 || !PreviewComponent) return;
    setSelectedFiles(files);
    setPublishOpen(true);
  }

  function closePublishPreview() {
    setPublishOpen(false);
    setSelectedFiles([]);
  }

  function onDragEnter(event: DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    setDragDepth((current) => current + 1);
  }

  function onDragLeave(event: DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    setDragDepth((current) => Math.max(0, current - 1));
  }

  function onDragOver(event: DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragDepth(0);
    handleFiles(filesFromFileList(event.dataTransfer.files));
  }

  return (
    <div
      className="relative grid min-h-0 gap-3"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <RepositoryBrowserBreadcrumbs
          repositoryName={repository.name}
          prefix={prefix}
          onPrefixChange={setPrefix}
        />
        {PreviewComponent && (
          <Button type="button" onClick={() => fileInputRef.current?.click()}>
            <PackagePlus className="mr-2 h-4 w-4" />
            Publish artifact
          </Button>
        )}
        {PreviewComponent && (
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(event) => {
              handleFiles(filesFromFileList(event.currentTarget.files));
              event.currentTarget.value = "";
            }}
          />
        )}
      </div>

      <Dialog open={publishOpen} onOpenChange={(open) => {
        if (open) {
          setPublishOpen(true);
          return;
        }
        closePublishPreview();
      }}>
        <DialogContent className={publishDrawerContentClass}>
          <DialogHeader>
            <DialogTitle>{publishPlugin?.title ?? "Publish artifact"}</DialogTitle>
          </DialogHeader>
          {PreviewComponent && (
            <PreviewComponent
              repository={repository}
              pluginMetadata={pluginMetadata}
              droppedFiles={selectedFiles}
              onCancel={closePublishPreview}
              onPublished={closePublishPreview}
            />
          )}
        </DialogContent>
      </Dialog>

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
          <RepositoryBrowserTable rows={rows} onOpenDirectory={setPrefix} />
        )}
      </div>

      {overlay && <RepositoryBrowserUploadOverlay overlay={overlay} />}

      <PublishSessionsSection
        repository={repository}
        pluginMetadata={pluginMetadata}
        {...(publishPlugin?.artifactSummary ? { artifactSummary: publishPlugin.artifactSummary } : {})}
        {...(publishPlugin?.SessionDetailComponent ? { SessionDetailComponent: publishPlugin.SessionDetailComponent } : {})}
      />
    </div>
  );
}

function RepositoryBrowserUploadOverlay({
  overlay,
}: {
  overlay: NonNullable<ReturnType<typeof repositoryBrowserUploadOverlay>>;
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
  onOpenDirectory,
}: {
  rows: RepositoryBrowserRow[];
  onOpenDirectory: (prefix: string) => void;
}) {
  return (
    <div className="max-h-[36rem] overflow-auto">
      <table className="w-full min-w-[40rem] table-fixed text-sm">
        <thead className="sticky top-0 bg-panel text-left text-xs text-muted-foreground">
          <tr>
            <th className="w-[45%] px-3 py-2 font-medium">Name</th>
            <th className="w-[25%] px-3 py-2 font-medium">Type</th>
            <th className="w-[15%] px-3 py-2 font-medium">Size</th>
            <th className="w-[15%] px-3 py-2 font-medium">Path</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.kind}:${row.path}`} className="border-t border-border">
              <td className="min-w-0 px-3 py-2">
                <RepositoryBrowserNameCell row={row} onOpenDirectory={onOpenDirectory} />
              </td>
              <td className="truncate px-3 py-2 text-muted-foreground">{row.contentType}</td>
              <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{row.sizeLabel}</td>
              <td className="truncate px-3 py-2 text-xs text-muted-foreground">{row.path}</td>
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
}: {
  row: RepositoryBrowserRow;
  onOpenDirectory: (prefix: string) => void;
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
    <div className="flex min-w-0 items-center gap-2">
      {icon}
      <span className="truncate font-medium">{row.name}</span>
    </div>
  );
}
