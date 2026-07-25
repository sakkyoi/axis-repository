import { Eye, Package, RefreshCcw, RotateCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { useDeleteRepositoryArtifact, useRebuildRepositoryArtifactIndex, useRepositoryArtifacts } from "../../api/hooks";
import type { RepositoryArtifact } from "../../api/schemas";
import { Button } from "../../components/ui/button";
import { CopyToClipboardButton } from "../../components/ui/copy-to-clipboard-button";
import { DestructiveActionDialog } from "../../components/ui/destructive-action-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { ErrorState } from "../../pages/shared";
import { repositoryEmptyStatePanelClass } from "../detail/repository-empty-state-model";
import type { RepositoryDetailSectionProps } from "../plugins/repository-ui-plugin-types";
import { repositoryArtifactDeleteDialogContent } from "./repository-artifacts-model";

export function RepositoryArtifactsSection({ repository }: RepositoryDetailSectionProps) {
  const artifacts = useRepositoryArtifacts(repository.name);
  const rebuildIndex = useRebuildRepositoryArtifactIndex(repository.name);
  const deleteArtifact = useDeleteRepositoryArtifact(repository.name);
  const [selectedArtifact, setSelectedArtifact] = useState<RepositoryArtifact>();
  const [pendingDeleteArtifact, setPendingDeleteArtifact] = useState<RepositoryArtifact>();
  const rows = artifacts.data?.artifacts ?? [];

  function closeDeleteDialog() {
    if (deleteArtifact.isPending) return;
    setPendingDeleteArtifact(undefined);
    deleteArtifact.reset();
  }

  function confirmDeleteArtifact() {
    if (!pendingDeleteArtifact) return;
    deleteArtifact.mutate(pendingDeleteArtifact.id, {
      onSuccess: () => {
        setSelectedArtifact(undefined);
        setPendingDeleteArtifact(undefined);
      },
    });
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          {rows.length === 1 ? "1 artifact" : `${rows.length} artifacts`}
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void artifacts.refetch()}>
            <RefreshCcw className="mr-2 h-3.5 w-3.5" />
            Refresh
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={rebuildIndex.isPending}
            onClick={() => rebuildIndex.mutate()}
          >
            <RotateCw className="mr-2 h-3.5 w-3.5" />
            {rebuildIndex.isPending ? "Rebuilding..." : "Rebuild index"}
          </Button>
        </div>
      </div>
      {rebuildIndex.isError && <ErrorState title="Artifact index rebuild failed" error={rebuildIndex.error} />}
      <div className="min-h-0 overflow-hidden rounded-md border border-border bg-background/40">
        {artifacts.isLoading && <div className="p-3 text-sm text-muted-foreground">Loading artifacts...</div>}
        {artifacts.isError && <div className="p-3"><ErrorState title="Repository artifacts unavailable" error={artifacts.error} /></div>}
        {!artifacts.isLoading && !artifacts.isError && rows.length === 0 && (
          <div className="grid min-h-64 p-3">
            <div className={repositoryEmptyStatePanelClass()}>
              No indexed artifacts yet. Publish artifacts or rebuild the index after adding repository contents.
            </div>
          </div>
        )}
        {!artifacts.isLoading && !artifacts.isError && rows.length > 0 && (
          <RepositoryArtifactsTable artifacts={rows} onOpenArtifact={setSelectedArtifact} />
        )}
      </div>
      <Dialog open={Boolean(selectedArtifact)} onOpenChange={(open) => {
        if (!open) setSelectedArtifact(undefined);
      }}>
        <DialogContent className="content-start grid-rows-[auto_minmax(0,1fr)] bottom-0 left-0 top-auto max-h-[88dvh] w-full translate-x-0 translate-y-0 overflow-hidden rounded-b-none sm:bottom-auto sm:left-auto sm:right-0 sm:top-0 sm:h-dvh sm:max-h-none sm:w-[min(92vw,460px)] sm:translate-x-0 sm:translate-y-0 sm:rounded-l-lg sm:rounded-r-none">
          <DialogHeader>
            <DialogTitle>Artifact detail</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto pr-1">
            {selectedArtifact && (
              <RepositoryArtifactDetail
                artifact={selectedArtifact}
                deleting={deleteArtifact.variables === selectedArtifact.id && deleteArtifact.isPending}
                onDelete={() => setPendingDeleteArtifact(selectedArtifact)}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
      {pendingDeleteArtifact && (
        <DestructiveActionDialog
          open={Boolean(pendingDeleteArtifact)}
          onOpenChange={(open) => {
            if (!open) closeDeleteDialog();
          }}
          pending={deleteArtifact.isPending}
          error={deleteArtifact.isError ? deleteArtifact.error : undefined}
          onConfirm={confirmDeleteArtifact}
          {...repositoryArtifactDeleteDialogContent(pendingDeleteArtifact)}
        />
      )}
    </div>
  );
}

function RepositoryArtifactsTable({
  artifacts,
  onOpenArtifact,
}: {
  artifacts: RepositoryArtifact[];
  onOpenArtifact: (artifact: RepositoryArtifact) => void;
}) {
  return (
    <div className="max-h-80 overflow-auto">
      <table className="w-full min-w-[42rem] table-fixed text-sm">
        <thead className="sticky top-0 bg-panel text-left text-xs text-muted-foreground">
          <tr>
            <th className="w-[34%] px-3 py-2 font-medium">Artifact</th>
            <th className="w-[14%] px-3 py-2 font-medium">Version</th>
            <th className="w-[16%] px-3 py-2 font-medium">Ecosystem</th>
            <th className="w-[20%] px-3 py-2 font-medium">Published</th>
            <th className="w-[12%] px-3 py-2 font-medium">Objects</th>
            <th className="w-[4rem] px-3 py-2 font-medium" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {artifacts.map((artifact) => (
            <tr key={artifact.id} className="border-t border-border">
              <td className="min-w-0 px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Package className="h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <div className="truncate font-medium">{artifact.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{artifact.summary}</div>
                  </div>
                </div>
              </td>
              <td className="truncate px-3 py-2 text-muted-foreground">{artifact.version ?? "-"}</td>
              <td className="truncate px-3 py-2 text-muted-foreground">{artifact.ecosystem}</td>
              <td className="truncate px-3 py-2 text-xs text-muted-foreground">{artifact.publishedAt}</td>
              <td className="truncate px-3 py-2 text-xs text-muted-foreground">
                {artifact.objectKeys.length === 1 ? "1 object" : `${artifact.objectKeys.length} objects`}
              </td>
              <td className="px-3 py-2 text-right">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground"
                  aria-label={`Open ${artifact.name}`}
                  title={`Open ${artifact.name}`}
                  onClick={() => onOpenArtifact(artifact)}
                >
                  <Eye className="h-4 w-4" />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RepositoryArtifactDetail({
  artifact,
  deleting,
  onDelete,
}: {
  artifact: RepositoryArtifact;
  deleting: boolean;
  onDelete: () => void;
}) {
  const primaryObjectUrl = artifact.primaryObjectKey
    ? `${window.location.origin}/${artifact.primaryObjectKey.split("/").map(encodeURIComponent).join("/")}`
    : undefined;
  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <div className="truncate text-sm font-semibold">{artifact.name}</div>
        <div className="break-all text-xs text-muted-foreground">{artifact.identity}</div>
      </div>
      <dl className="grid gap-2 text-sm">
        <ArtifactDetailItem label="Summary" value={artifact.summary} />
        <ArtifactDetailItem label="Version" value={artifact.version ?? "-"} />
        <ArtifactDetailItem label="Published" value={artifact.publishedAt} />
        <ArtifactDetailItem label="Updated" value={artifact.updatedAt} />
        <ArtifactDetailItem label="Publish session" value={artifact.publishSessionId ?? "-"} />
        <ArtifactDetailItem label="Primary object" value={artifact.primaryObjectKey ?? "-"} />
      </dl>
      <div className="flex flex-wrap justify-end gap-2">
        {primaryObjectUrl && (
          <CopyToClipboardButton type="button" variant="outline" text={primaryObjectUrl} label="Copy URL" copiedLabel="Copied" />
        )}
        <Button type="button" variant="destructive" disabled={deleting} onClick={onDelete}>
          <Trash2 className="mr-2 h-4 w-4" />
          {deleting ? "Deleting..." : "Delete"}
        </Button>
      </div>
      <div className="grid gap-2">
        <div className="text-xs font-medium text-muted-foreground">Objects</div>
        <ul className="grid gap-1 text-xs">
          {artifact.objectKeys.length === 0 ? (
            <li className="rounded bg-muted px-2 py-1 text-muted-foreground">None</li>
          ) : artifact.objectKeys.map((objectKey) => (
            <li key={objectKey} className="break-all rounded bg-muted px-2 py-1">{objectKey}</li>
          ))}
        </ul>
      </div>
      <div className="grid gap-2">
        <div className="text-xs font-medium text-muted-foreground">Metadata</div>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs">
          {JSON.stringify(artifact.metadata, null, 2)}
        </pre>
      </div>
    </div>
  );
}

function ArtifactDetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 rounded-md border border-border bg-background/40 p-2">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="break-all text-xs">{value}</dd>
    </div>
  );
}
