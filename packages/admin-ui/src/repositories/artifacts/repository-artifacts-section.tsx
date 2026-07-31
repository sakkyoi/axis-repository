import { Eye, Package, RefreshCcw, RotateCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useDeleteRepositoryArtifact, useRebuildRepositoryArtifactIndex, useRepositoryArtifacts } from "../../api/hooks";
import type { RepositoryArtifact } from "../../api/schemas";
import { Button } from "../../components/ui/button";
import { CopyToClipboardButton } from "../../components/ui/copy-to-clipboard-button";
import { DestructiveActionDialog } from "../../components/ui/destructive-action-dialog";
import { useErrorToast, useToast } from "../../components/ui/toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { ErrorState } from "../../pages/shared";
import { CodeBlock } from "../../components/ui/code-block";
import { SkeletonRows } from "../../components/ui/skeleton";
import { cn } from "../../lib/utils";
import { moreChoicesLabel, visibleChoices } from "./artifact-choice-model";
import {
  artifactVariantLabel,
  artifactVersionCountLabel,
  artifactsForVersion,
  groupArtifactsByFamily,
  type ArtifactGroup,
} from "./artifact-groups-model";
import type { RepositoryDetailSectionProps } from "../plugins/repository-ui-plugin-types";
import {
  repositoryArtifactDeleteDialogContent,
  repositoryArtifactObjectRelativePath,
} from "./repository-artifacts-model";

export function RepositoryArtifactsSection({ repository }: RepositoryDetailSectionProps) {
  const artifacts = useRepositoryArtifacts(repository.name);
  const rebuildIndex = useRebuildRepositoryArtifactIndex(repository.name);
  const deleteArtifact = useDeleteRepositoryArtifact(repository.name);
  const toast = useToast();
  useErrorToast("Artifact index rebuild failed", rebuildIndex.error);
  useErrorToast("Artifact not deleted", deleteArtifact.error);
  const [, setSearchParams] = useSearchParams();
  const [openGroupKey, setOpenGroupKey] = useState<string>();
  const [selectedArtifact, setSelectedArtifact] = useState<RepositoryArtifact>();
  const [pendingDeleteArtifact, setPendingDeleteArtifact] = useState<RepositoryArtifact>();
  const rows = artifacts.data?.artifacts ?? [];
  const groups = groupArtifactsByFamily(rows);
  // Re-read from the current grouping rather than held: a rebuild replaces
  // every artifact, and a version kept in state would go on describing one
  // that is no longer there.
  const openGroup = groups.find((group) => group.key === openGroupKey);

  function openArtifactGroup(group: ArtifactGroup) {
    setOpenGroupKey(group.key);
    setSelectedArtifact(group.latest);
  }

  // The chosen version, and within it the chosen build. Choosing a version
  // keeps the build where one of the same name exists -- looking at arm64 and
  // stepping back a version should not land on amd64.
  function selectVersion(version: string) {
    if (!openGroup) return;
    const variants = artifactsForVersion(openGroup, version);
    const sameVariant = variants.find((variant) =>
      artifactVariantLabel(variant) === artifactVariantLabel(selectedArtifact ?? variant));
    setSelectedArtifact(sameVariant ?? variants[0]);
  }

  function selectVariant(label: string) {
    if (!openGroup || !selectedArtifact) return;
    const variants = artifactsForVersion(openGroup, selectedArtifact.version ?? "");
    setSelectedArtifact(variants.find((variant) => artifactVariantLabel(variant) === label) ?? selectedArtifact);
  }

  function closeArtifactGroup() {
    setOpenGroupKey(undefined);
    setSelectedArtifact(undefined);
  }

  function closeDeleteDialog() {
    if (deleteArtifact.isPending) return;
    setPendingDeleteArtifact(undefined);
    deleteArtifact.reset();
  }

  function confirmDeleteArtifact() {
    if (!pendingDeleteArtifact) return;
    deleteArtifact.mutate(pendingDeleteArtifact.id, {
      onSuccess: (result) => {
        closeArtifactGroup();
        setPendingDeleteArtifact(undefined);
        toast.notify({
          title: "Artifact delete finished",
          description: [
            `${result.deletedObjectKeys.length} deleted`,
            result.missingObjectKeys.length > 0 ? `${result.missingObjectKeys.length} missing` : undefined,
            result.skippedObjectKeys.length > 0 ? `${result.skippedObjectKeys.length} skipped` : undefined,
            result.failedObjectKeys.length > 0 ? `${result.failedObjectKeys.length} failed` : undefined,
          ].filter(Boolean).join(", "),
        });
      },
    });
  }

  function openArtifactObject(objectKey: string) {
    const objectPath = repositoryArtifactObjectRelativePath(repository.name, objectKey);
    if (!objectPath) return;
    setSelectedArtifact(undefined);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("object", objectPath);
      return next;
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
            onClick={() => rebuildIndex.mutate(undefined, {
              onSuccess: (result) => {
                toast.notify({
                  title: "Artifact index rebuilt",
                  description: `${result.artifacts.length} artifact${result.artifacts.length === 1 ? "" : "s"} indexed.`,
                });
              },
            })}
          >
            <RotateCw className="mr-2 h-3.5 w-3.5" />
            {rebuildIndex.isPending ? "Rebuilding..." : "Rebuild index"}
          </Button>
        </div>
      </div>
      <div className="min-h-0 overflow-hidden rounded-md border border-border bg-background/40">
        {artifacts.isLoading && <SkeletonRows rows={4} columns={["w-40", "w-14", "w-16", "w-44", "w-20"]} />}
        {artifacts.isError && <div className="p-3"><ErrorState title="Repository artifacts unavailable" error={artifacts.error} /></div>}
        {!artifacts.isLoading && !artifacts.isError && rows.length === 0 && (
          <div className="grid min-h-64 p-3">
            <div className="grid min-h-[calc(16rem-1.5rem)] place-items-center rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No indexed artifacts yet. Publish artifacts or rebuild the index after adding repository contents.
            </div>
          </div>
        )}
        {!artifacts.isLoading && !artifacts.isError && rows.length > 0 && (
          <RepositoryArtifactsTable groups={groups} onOpenGroup={openArtifactGroup} />
        )}
      </div>
      <Dialog open={Boolean(openGroup)} onOpenChange={(open) => {
        if (!open) closeArtifactGroup();
      }}>
        <DialogContent className="content-start grid-rows-[auto_minmax(0,1fr)] bottom-0 left-0 top-auto max-h-[88dvh] w-full translate-x-0 translate-y-0 overflow-hidden rounded-b-none sm:bottom-auto sm:left-auto sm:right-0 sm:top-0 sm:h-dvh sm:max-h-none sm:w-[min(92vw,460px)] sm:translate-x-0 sm:translate-y-0 sm:rounded-l-lg sm:rounded-r-none">
          <DialogHeader>
            <DialogTitle>
              {openGroup ? openGroup.name : "Artifact detail"}
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto pr-1">
            {openGroup && (
              <div className="grid gap-4">
                <ArtifactChoice
                  label="Version"
                  options={openGroup.versions.map((version) => ({ value: version, label: version || "-" }))}
                  selected={selectedArtifact?.version ?? ""}
                  onSelect={selectVersion}
                />
                <ArtifactChoice
                  label="Architecture"
                  options={artifactsForVersion(openGroup, selectedArtifact?.version ?? "")
                    .map((variant) => artifactVariantLabel(variant))
                    .filter((label): label is string => label !== undefined)
                    .map((label) => ({ value: label, label }))}
                  selected={selectedArtifact ? artifactVariantLabel(selectedArtifact) : undefined}
                  onSelect={selectVariant}
                />
                {selectedArtifact && (
                  <RepositoryArtifactDetail
                    artifact={selectedArtifact}
                    repositoryName={repository.name}
                    deleting={deleteArtifact.variables === selectedArtifact.id && deleteArtifact.isPending}
                    onOpenObject={openArtifactObject}
                    onDelete={() => setPendingDeleteArtifact(selectedArtifact)}
                  />
                )}
              </div>
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
  groups,
  onOpenGroup,
}: {
  groups: ArtifactGroup[];
  onOpenGroup: (group: ArtifactGroup) => void;
}) {
  return (
    <div className="max-h-80 overflow-auto">
      <table className="w-full min-w-[42rem] table-fixed text-sm">
        <thead className="sticky top-0 bg-panel text-left text-xs text-muted-foreground">
          <tr>
            <th className="w-[40%] px-3 py-2 font-medium">Artifact</th>
            <th className="w-[14%] px-3 py-2 font-medium">Latest</th>
            <th className="w-[16%] px-3 py-2 font-medium">Versions</th>
            <th className="w-[22%] px-3 py-2 font-medium">Updated</th>
            <th className="w-[4rem] px-3 py-2 font-medium" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <tr key={group.key} className="border-t border-border">
              <td className="min-w-0 px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Package className="h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <div className="truncate font-medium">{group.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{group.latest.summary}</div>
                  </div>
                </div>
              </td>
              <td className="truncate px-3 py-2 text-muted-foreground">{group.latest.version ?? "-"}</td>
              <td className="truncate px-3 py-2 text-xs text-muted-foreground">
                {artifactVersionCountLabel(group) ?? "1 version"}
              </td>
              <td className="truncate px-3 py-2 text-xs text-muted-foreground">{group.latest.publishedAt}</td>
              <td className="px-3 py-2 text-right">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground"
                  aria-label={`Open ${group.name}`}
                  title={`Open ${group.name}`}
                  onClick={() => onOpenGroup(group)}
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

/**
 * One choice among short ones, which is what a version or an architecture is.
 *
 * All of them at once for as long as that reads as a row; past that the newest
 * few, and the rest behind a count that says how many were left out. What is
 * selected is always among those shown, or the row would look like nothing had
 * been chosen.
 */
function ArtifactChoice({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  selected: string | undefined;
  onSelect: (value: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { shown, hidden } = visibleChoices({
    options,
    isSelected: (option) => option.value === selected,
    expanded,
  });

  // One option is not a choice, and a row of buttons offering it says there is
  // something to decide where there is not.
  if (options.length < 2) {
    return null;
  }

  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        {expanded && options.length > shown.length + hidden && (
          <span className="text-xs text-muted-foreground">{options.length}</span>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
        {shown.map((option) => {
          const active = option.value === selected;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onSelect(option.value)}
              aria-pressed={active}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          );
        })}
        {(hidden > 0 || expanded) && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            className="rounded-md border border-dashed border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {expanded ? "Show fewer" : moreChoicesLabel(hidden)}
          </button>
        )}
      </div>
    </div>
  );
}

function RepositoryArtifactDetail({
  artifact,
  repositoryName,
  deleting,
  onOpenObject,
  onDelete,
}: {
  artifact: RepositoryArtifact;
  repositoryName: string;
  deleting: boolean;
  onOpenObject: (objectKey: string) => void;
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
          ) : artifact.objectKeys.map((objectKey) => {
            const objectPath = repositoryArtifactObjectRelativePath(repositoryName, objectKey);
            return (
              <li key={objectKey} className="flex min-w-0 items-center justify-between gap-2 rounded bg-muted px-2 py-1">
                <span className="min-w-0 break-all">{objectKey}</span>
                {objectPath && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-muted-foreground"
                    aria-label={`Open object ${objectPath}`}
                    title={`Open object ${objectPath}`}
                    onClick={() => onOpenObject(objectKey)}
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <div className="grid gap-2">
        <div className="text-xs font-medium text-muted-foreground">Metadata</div>
        <CodeBlock
          className="max-h-64 whitespace-pre-wrap break-words"
          language="json"
          code={JSON.stringify(artifact.metadata, null, 2)}
        />
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
