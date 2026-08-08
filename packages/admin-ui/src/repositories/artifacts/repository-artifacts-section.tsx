import { Eye, Package, RefreshCcw, RotateCw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  useAxisClient,
  useDeleteRepositoryArtifact,
  useRebuildRepositoryArtifactIndex,
  useRepositoryArtifactIndexJob,
  useRepositoryArtifactFamiliesPages,
  useRepositoryArtifactFamilyArtifacts,
} from "../../api/hooks";
import type { RepositoryArtifact, RepositoryArtifactFamily } from "../../api/schemas";
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
  artifactFamilyVersionLabel,
  artifactFamilySummaryLabel,
  artifactVariantLabel,
  artifactsForVersion,
  groupArtifactsByFamily,
  pypiProxyProjectArtifactName,
  pypiProxyProjectFamilyName,
} from "./artifact-groups-model";
import { repositoryIndexJobIsActive, repositoryIndexJobStatusView } from "./repository-index-job-model";
import type { RepositoryDetailSectionProps } from "../plugins/repository-ui-plugin-types";
import {
  repositoryArtifactDeleteDialogContent,
  repositoryArtifactObjectRelativePath,
} from "./repository-artifacts-model";

export function RepositoryArtifactsSection({ repository }: RepositoryDetailSectionProps) {
  const familiesQuery = useRepositoryArtifactFamiliesPages(repository.name);
  const indexJob = useRepositoryArtifactIndexJob(repository.name);
  const rebuildIndex = useRebuildRepositoryArtifactIndex(repository.name);
  const deleteArtifact = useDeleteRepositoryArtifact(repository.name);
  const toast = useToast();
  useErrorToast("Artifact index rebuild failed", rebuildIndex.error);
  useErrorToast("Artifact not deleted", deleteArtifact.error);
  const [, setSearchParams] = useSearchParams();
  const [openFamilyKey, setOpenFamilyKey] = useState<string>();
  const [selectedArtifact, setSelectedArtifact] = useState<RepositoryArtifact>();
  const [pendingDeleteArtifact, setPendingDeleteArtifact] = useState<RepositoryArtifact>();
  const familyArtifactsQuery = useRepositoryArtifactFamilyArtifacts(repository.name, openFamilyKey);
  const pypiProxyProject = pypiProxyProjectFamilyName(openFamilyKey);
  const pypiProject = usePypiProxyProjectCache(repository.name, pypiProxyProject);
  const pages = familiesQuery.data?.pages ?? [];
  const families = pages.flatMap((page) => page.families);
  const totalFamilies = pages[0]?.totalFamilies ?? families.length;
  const totalArtifacts = pages[0]?.totalArtifacts ?? families.reduce((total, family) => total + family.artifactCount, 0);
  const indexJobIsRunning = repositoryIndexJobIsActive(indexJob.data?.job);
  const indexJobView = repositoryIndexJobStatusView(indexJob.data?.job);
  const detailGroups = groupArtifactsByFamily(familyArtifactsQuery.data?.artifacts ?? []);
  // Re-read from the current grouping rather than held: a rebuild replaces
  // every artifact, and a version kept in state would go on describing one
  // that is no longer there.
  const openGroup = detailGroups.find((group) => group.key === openFamilyKey);

  useEffect(() => {
    if (!openGroup) return;
    if (selectedArtifact && openGroup.artifacts.some((artifact) => artifact.id === selectedArtifact.id)) return;
    setSelectedArtifact(openGroup.latest);
  }, [openGroup, selectedArtifact]);

  useEffect(() => {
    if (!pypiProxyProject) return;
    void pypiProject.refetch();
  }, [pypiProject.refetch, pypiProxyProject]);

  useEffect(() => {
    if (!pypiProject.data || !pypiProxyProject) return;
    void familiesQuery.refetch();
    void familyArtifactsQuery.refetch();
  }, [familiesQuery, familyArtifactsQuery, pypiProject.data, pypiProxyProject]);

  function openArtifactFamily(family: RepositoryArtifactFamily) {
    setOpenFamilyKey(family.key);
    setSelectedArtifact(family.latestArtifact);
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
    setOpenFamilyKey(undefined);
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
          {artifactFamilyCountLabel(totalFamilies, totalArtifacts, { cached: indexJobIsRunning })}
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void familiesQuery.refetch()}>
            <RefreshCcw className="mr-2 h-3.5 w-3.5" />
            Refresh
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={rebuildIndex.isPending || indexJobIsRunning}
            onClick={() => rebuildIndex.mutate(undefined, {
              onSuccess: () => {
                toast.notify({
                  title: "Repository index refresh started",
                  description: "The job is running in the background.",
                  action: { label: "View jobs", to: "/ui/jobs" },
                });
              },
            })}
          >
            <RotateCw className="mr-2 h-3.5 w-3.5" />
            {rebuildIndex.isPending || indexJobIsRunning ? "Rebuilding..." : "Rebuild index"}
          </Button>
        </div>
      </div>
      <div className="min-h-0 overflow-hidden rounded-md border border-border bg-background/40">
        {indexJobView && (
          <div className={cn(
            "border-b border-border px-3 py-2 text-xs",
            indexJobView.failed ? "bg-destructive/10 text-destructive" : "bg-muted/40 text-muted-foreground",
          )}>
            <span className="font-medium text-foreground">{indexJobView.label}</span>
            <span className="ml-2">{indexJobView.description}</span>
          </div>
        )}
        {familiesQuery.isLoading && <SkeletonRows rows={4} columns={["w-40", "w-14", "w-16", "w-44", "w-20"]} />}
        {familiesQuery.isError && <div className="p-3"><ErrorState title="Repository artifacts unavailable" error={familiesQuery.error} /></div>}
        {!familiesQuery.isLoading && !familiesQuery.isError && families.length === 0 && (
          <div className="grid min-h-64 p-3">
            <div className="grid min-h-[calc(16rem-1.5rem)] place-items-center rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No indexed artifacts yet. Publish artifacts or rebuild the index after adding repository contents.
            </div>
          </div>
        )}
        {!familiesQuery.isLoading && !familiesQuery.isError && families.length > 0 && (
          <RepositoryArtifactsTable
            families={families}
            hasNextPage={familiesQuery.hasNextPage}
            loadingNextPage={familiesQuery.isFetchingNextPage}
            onLoadNextPage={() => void familiesQuery.fetchNextPage()}
            onOpenFamily={openArtifactFamily}
          />
        )}
      </div>
      <Dialog open={Boolean(openFamilyKey)} onOpenChange={(open) => {
        if (!open) closeArtifactGroup();
      }}>
        <DialogContent className="content-start grid-rows-[auto_minmax(0,1fr)] bottom-0 left-0 top-auto max-h-[88dvh] w-full translate-x-0 translate-y-0 overflow-hidden rounded-b-none sm:bottom-auto sm:left-auto sm:right-0 sm:top-0 sm:h-dvh sm:max-h-none sm:w-[min(92vw,460px)] sm:translate-x-0 sm:translate-y-0 sm:rounded-l-lg sm:rounded-r-none">
          <DialogHeader>
            <DialogTitle>
              {openGroup ? openGroup.name : "Artifact detail"}
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto pr-1">
            {familyArtifactsQuery.isLoading && (
              <SkeletonRows rows={3} columns={["w-24", "w-32"]} />
            )}
            {familyArtifactsQuery.isError && (
              <ErrorState title="Artifact detail unavailable" error={familyArtifactsQuery.error} />
            )}
            {!familyArtifactsQuery.isLoading && !familyArtifactsQuery.isError && openGroup && (
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
                    cachedFileCount={pypiProxyProject ? pypiProject.data?.files.length : undefined}
                    loadingCachedFiles={pypiProxyProject ? pypiProject.isLoading : false}
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
  families,
  hasNextPage,
  loadingNextPage,
  onLoadNextPage,
  onOpenFamily,
}: {
  families: RepositoryArtifactFamily[];
  hasNextPage: boolean;
  loadingNextPage: boolean;
  onLoadNextPage: () => void;
  onOpenFamily: (family: RepositoryArtifactFamily) => void;
}) {
  const scrollRootRef = useRef<HTMLDivElement>(null);
  const loadBoundaryRef = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    const root = scrollRootRef.current;
    const boundary = loadBoundaryRef.current;
    if (!root || !boundary || !hasNextPage || loadingNextPage || !("IntersectionObserver" in window)) {
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        onLoadNextPage();
      }
    }, {
      root,
      rootMargin: "48px 0px",
    });
    observer.observe(boundary);
    return () => observer.disconnect();
  }, [hasNextPage, loadingNextPage, onLoadNextPage]);

  return (
    <div ref={scrollRootRef} className="max-h-80 overflow-auto">
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
          {families.map((family) => (
            <tr key={family.key} className="border-t border-border">
              <td className="min-w-0 px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Package className="h-4 w-4 shrink-0 text-primary-ink" />
                  <div className="min-w-0">
                    <div className="truncate font-medium">{family.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{artifactFamilySummaryLabel(family)}</div>
                  </div>
                </div>
              </td>
              <td className="truncate px-3 py-2 text-muted-foreground">{family.latestVersion ?? "-"}</td>
              <td className="truncate px-3 py-2 text-xs text-muted-foreground">
                {artifactFamilyVersionLabel(family)}
              </td>
              <td className="truncate px-3 py-2 text-xs text-muted-foreground">{family.updatedAt}</td>
              <td className="px-3 py-2 text-right">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground"
                  aria-label={`Open ${family.name}`}
                  title={`Open ${family.name}`}
                  onClick={() => onOpenFamily(family)}
                >
                  <Eye className="h-4 w-4" />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
        {(hasNextPage || loadingNextPage) && (
          <tfoot>
            <tr ref={loadBoundaryRef} aria-hidden={!loadingNextPage}>
              <td colSpan={5} className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
                {loadingNextPage ? "Loading more..." : ""}
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

function artifactFamilyCountLabel(
  totalFamilies: number,
  totalArtifacts: number,
  options: { cached?: boolean } = {},
): string {
  const familyLabel = totalFamilies === 1 ? "1 package" : `${totalFamilies} packages`;
  const artifactLabel = totalArtifacts === 1 ? "1 artifact" : `${totalArtifacts} artifacts`;
  const label = `${familyLabel}, ${artifactLabel}`;
  return options.cached ? `Cached ${label}` : label;
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
                  ? "border-primary bg-primary-ink/10 text-primary-ink"
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
  cachedFileCount,
  loadingCachedFiles,
  deleting,
  onOpenObject,
  onDelete,
}: {
  artifact: RepositoryArtifact;
  repositoryName: string;
  cachedFileCount: number | undefined;
  loadingCachedFiles: boolean;
  deleting: boolean;
  onOpenObject: (objectKey: string) => void;
  onDelete: () => void;
}) {
  const pypiProxyProject = pypiProxyProjectArtifactName(artifact);
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
        {pypiProxyProject && (
          <ArtifactDetailItem
            label="Cached files"
            value={loadingCachedFiles ? "Loading..." : cachedFileCount === undefined ? "-" : String(cachedFileCount)}
          />
        )}
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

function usePypiProxyProjectCache(repositoryName: string, project: string | undefined) {
  const client = useAxisClient();
  return useQuery({
    queryKey: ["pypi-projects", repositoryName, "project", project],
    queryFn: async () => {
      const response = await client.getRepositoryPluginResource(repositoryName, "pypi", ["projects", project ?? ""]);
      return parsePypiProjectResource(response);
    },
    enabled: false,
  });
}

function parsePypiProjectResource(response: unknown): { name: string; files: unknown[] } {
  if (!response || typeof response !== "object" || !("project" in response)) {
    return { name: "", files: [] };
  }
  const project = (response as { project?: unknown }).project;
  if (!project || typeof project !== "object") {
    return { name: "", files: [] };
  }
  const record = project as Record<string, unknown>;
  return {
    name: typeof record.name === "string" ? record.name : "",
    files: Array.isArray(record.files) ? record.files : [],
  };
}

function ArtifactDetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 rounded-md border border-border bg-background/40 p-2">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="break-all text-xs">{value}</dd>
    </div>
  );
}
