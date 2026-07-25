import { File, Folder, PackagePlus, UploadCloud } from "lucide-react";
import type { DragEvent } from "react";
import { useState } from "react";
import { useRepositoryObjects } from "../../api/hooks";
import { Button } from "../../components/ui/button";
import { EmptyState, ErrorState } from "../../pages/shared";
import { PublishSessionsSection } from "../detail/repository-detail-shared";
import { getRepositoryPublishPlugin } from "../plugins/repository-ui-plugins";
import type { RepositoryDetailSectionProps } from "../plugins/repository-ui-plugin-types";
import {
  repositoryBrowserBreadcrumbs,
  repositoryBrowserRows,
  type RepositoryBrowserRow,
} from "./repository-browser-model";

export function RepositoryBrowserSection({
  repository,
  pluginMetadata,
}: RepositoryDetailSectionProps) {
  const [prefix, setPrefix] = useState("");
  const [publishOpen, setPublishOpen] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState<File[]>([]);
  const objects = useRepositoryObjects(repository.name, prefix);
  const publishPlugin = getRepositoryPublishPlugin(repository.ecosystem);
  const FormComponent = publishPlugin?.FormComponent;
  const rows = objects.data ? repositoryBrowserRows(objects.data) : [];

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const files = [...event.dataTransfer.files];
    if (files.length === 0 || !FormComponent) return;
    setDroppedFiles(files);
    setPublishOpen(true);
  }

  return (
    <div className="grid min-h-0 gap-3">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <RepositoryBrowserBreadcrumbs
          repositoryName={repository.name}
          prefix={prefix}
          onPrefixChange={setPrefix}
        />
        {FormComponent && (
          <Button type="button" onClick={() => setPublishOpen((current) => !current)}>
            <PackagePlus className="mr-2 h-4 w-4" />
            Publish artifact
          </Button>
        )}
      </div>

      {publishOpen && FormComponent && (
        <FormComponent repository={repository} pluginMetadata={pluginMetadata} droppedFiles={droppedFiles} />
      )}

      <div
        className="min-h-64 overflow-hidden rounded-md border border-border bg-background/40"
        onDragOver={(event) => {
          if (FormComponent) event.preventDefault();
        }}
        onDrop={onDrop}
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs text-muted-foreground">
          <UploadCloud className="h-4 w-4" />
          Drop files here to publish, or browse repository contents.
        </div>
        {objects.isLoading && <div className="p-3 text-sm text-muted-foreground">Loading objects...</div>}
        {objects.isError && <div className="p-3"><ErrorState title="Repository objects unavailable" error={objects.error} /></div>}
        {!objects.isLoading && !objects.isError && rows.length === 0 && (
          <div className="p-3">
            <EmptyState message="No repository objects at this path." />
          </div>
        )}
        {!objects.isLoading && !objects.isError && rows.length > 0 && (
          <RepositoryBrowserTable rows={rows} onOpenDirectory={setPrefix} />
        )}
      </div>

      <PublishSessionsSection
        repository={repository}
        pluginMetadata={pluginMetadata}
        {...(publishPlugin?.artifactSummary ? { artifactSummary: publishPlugin.artifactSummary } : {})}
        {...(publishPlugin?.SessionDetailComponent ? { SessionDetailComponent: publishPlugin.SessionDetailComponent } : {})}
      />
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
