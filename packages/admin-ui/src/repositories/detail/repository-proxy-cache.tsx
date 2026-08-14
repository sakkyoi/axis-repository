import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCw, Trash2 } from "lucide-react";
import { z } from "zod";
import { useAxisClient, useRepositoryArtifactIndexJob } from "../../api/hooks";
import type { Repository } from "../../api/schemas";
import { Button } from "../../components/ui/button";
import { DestructiveActionDialog } from "../../components/ui/destructive-action-dialog";
import { useErrorToast, useToast } from "../../components/ui/toast";
import { formatDate } from "../../pages/shared";
import { repositoryIndexJobIsActive, repositoryIndexJobStatusView } from "../artifacts/repository-index-job-model";

const backgroundJobSchema = z.object({
  id: z.string(),
  type: z.string(),
  status: z.enum(["pending", "running", "succeeded", "failed", "canceling", "canceled"]),
  subject: z.object({
    type: z.enum(["repository", "publish-session", "upload", "artifact", "system"]),
    id: z.string(),
    repositoryName: z.string().optional(),
  }),
  repositoryName: z.string().optional(),
  priority: z.number(),
  attempts: z.number(),
  maxAttempts: z.number().optional(),
  requestedAt: z.string(),
  scheduledAt: z.string(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  progress: z.object({
    current: z.number().optional(),
    total: z.number().optional(),
    message: z.string().optional(),
  }).optional(),
  result: z.record(z.string(), z.unknown()).optional(),
  failure: z.object({
    message: z.string(),
    failedAt: z.string(),
    retryable: z.boolean(),
  }).optional(),
});

export const repositoryProxyCacheStatsSchema = z.object({
  fileCount: z.number(),
  byteCount: z.number(),
  catalogProjectCount: z.number().optional(),
  catalogRefreshedAt: z.string().optional(),
});

const repositoryProxyCacheSchema = z.object({
  cache: repositoryProxyCacheStatsSchema,
});

const repositoryProxyCachePurgeSchema = z.object({
  job: backgroundJobSchema,
});

export type RepositoryProxyCacheStats = z.infer<typeof repositoryProxyCacheStatsSchema>;
export type RepositoryProxyCachePurge = z.infer<typeof repositoryProxyCachePurgeSchema>;

interface RepositoryProxyCacheClient {
  getRepositoryPluginResource(
    repositoryName: string,
    namespace: string,
    path: readonly string[],
  ): Promise<unknown>;
  postRepositoryPluginResource(
    repositoryName: string,
    namespace: string,
    path: readonly string[],
    input?: unknown,
  ): Promise<unknown>;
}

export async function getRepositoryProxyCache(
  client: RepositoryProxyCacheClient,
  repositoryName: string,
  namespace: string,
): Promise<RepositoryProxyCacheStats> {
  const response = await client.getRepositoryPluginResource(repositoryName, namespace, ["proxy-cache"]);
  return repositoryProxyCacheSchema.parse(response).cache;
}

export async function purgeRepositoryProxyCache(
  client: RepositoryProxyCacheClient,
  repositoryName: string,
  namespace: string,
): Promise<RepositoryProxyCachePurge> {
  const response = await client.postRepositoryPluginResource(repositoryName, namespace, ["proxy-cache", "purge"]);
  return repositoryProxyCachePurgeSchema.parse(response);
}

export function useRepositoryProxyCache(
  repositoryName: string | undefined,
  namespace: string,
  enabled: boolean,
) {
  const client = useAxisClient();
  return useQuery({
    queryKey: ["repository-proxy-cache", namespace, repositoryName],
    queryFn: () => getRepositoryProxyCache(client, repositoryName ?? "", namespace),
    enabled: Boolean(repositoryName) && enabled,
  });
}

export function usePurgeRepositoryProxyCache(repositoryName: string | undefined, namespace: string) {
  const client = useAxisClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => purgeRepositoryProxyCache(client, repositoryName ?? "", namespace),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["background-job", result.job.id] });
      void queryClient.invalidateQueries({ queryKey: ["background-jobs"] });
      void queryClient.invalidateQueries({ queryKey: ["repository-objects", repositoryName] });
      void queryClient.invalidateQueries({ queryKey: ["repository-proxy-cache", namespace, repositoryName] });
    },
  });
}

export function RepositoryProxyIndexRefreshButton({
  repositoryName,
  label = "Refresh upstream cache",
  pendingLabel = "Refreshing...",
  errorTitle = "Proxy index refresh failed",
  extraInvalidateQueryKeys = [],
}: {
  repositoryName: string;
  label?: string;
  pendingLabel?: string;
  errorTitle?: string;
  extraInvalidateQueryKeys?: Array<readonly unknown[]>;
}) {
  const client = useAxisClient();
  const queryClient = useQueryClient();
  const indexJob = useRepositoryArtifactIndexJob(repositoryName);
  const indexJobView = repositoryIndexJobStatusView(indexJob.data?.job);
  const indexJobIsActive = repositoryIndexJobIsActive(indexJob.data?.job);
  const refresh = useMutation({
    mutationFn: () => client.rebuildRepositoryArtifactIndex(repositoryName),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["background-job", result.job.id] });
      void queryClient.invalidateQueries({ queryKey: ["background-jobs"] });
      void queryClient.invalidateQueries({ queryKey: ["repository-artifacts", repositoryName] });
      void queryClient.invalidateQueries({ queryKey: ["repository-artifacts", repositoryName, "pages"] });
      void queryClient.invalidateQueries({ queryKey: ["repository-artifact-families", repositoryName, "pages"] });
      void queryClient.invalidateQueries({ queryKey: ["repository-objects", repositoryName] });
      void queryClient.invalidateQueries({ queryKey: ["repository-object-detail", repositoryName] });
      void queryClient.invalidateQueries({ queryKey: ["repository-activity", repositoryName] });
      for (const queryKey of extraInvalidateQueryKeys) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
  });
  useErrorToast(errorTitle, refresh.error);

  return (
    <div className="grid gap-2">
      {indexJobView && (
        <div className={[
          "rounded-md border px-3 py-2 text-xs",
          indexJobView.failed
            ? "border-destructive/40 bg-destructive/10 text-destructive"
            : "border-border bg-muted/30 text-muted-foreground",
        ].join(" ")}>
          <span className="font-medium text-foreground">{indexJobView.label}</span>
          <span className="ml-2">{indexJobView.description}</span>
        </div>
      )}
      <Button type="button" variant="outline" onClick={() => refresh.mutate()} disabled={refresh.isPending || indexJobIsActive}>
        <RotateCw className="mr-2 h-4 w-4" />
        {refresh.isPending || indexJobIsActive ? pendingLabel : label}
      </Button>
    </div>
  );
}

export function RepositoryProxyCachePanel({
  repository,
  namespace,
  label = "Proxy",
}: {
  repository: Repository;
  namespace: string;
  label?: string;
}) {
  const byteCache = useRepositoryProxyCache(repository.name, namespace, repository.kind === "proxy");
  const purgeByteCache = usePurgeRepositoryProxyCache(repository.name, namespace);
  const [purgeDialogOpen, setPurgeDialogOpen] = useState(false);
  const toast = useToast();
  useErrorToast(`${label} byte cache unavailable`, byteCache.error);
  useErrorToast(`${label} byte cache purge failed`, purgeByteCache.error);
  const byteCacheStats = byteCache.data;
  const purgeDisabled = purgeByteCache.isPending || !byteCacheStats || byteCacheStats.fileCount === 0;

  function confirmPurgeByteCache() {
    purgeByteCache.mutate(undefined, {
      onSuccess: (result) => {
        setPurgeDialogOpen(false);
        toast.notify({
          title: `${label} byte cache purge started`,
          description: `Background job ${result.job.id} is purging cached files.`,
        });
      },
    });
  }

  return (
    <div className="grid gap-2 rounded-md border border-border bg-background/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid gap-0.5">
          <span className="text-xs font-medium uppercase text-muted-foreground">Byte cache</span>
          <span className="text-sm">
            {byteCache.isLoading
              ? "Loading..."
              : byteCacheStats
                ? `${byteCacheStats.fileCount} files, ${formatBytes(byteCacheStats.byteCount)}`
                : "-"}
          </span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={purgeDisabled}
          onClick={() => setPurgeDialogOpen(true)}
        >
          <Trash2 className="mr-2 h-3.5 w-3.5" />
          {purgeByteCache.isPending ? "Purging..." : "Purge"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {byteCacheStats?.catalogProjectCount !== undefined
          ? `${byteCacheStats.catalogProjectCount} catalog projects cached${
            byteCacheStats.catalogRefreshedAt ? `; refreshed ${formatDate(byteCacheStats.catalogRefreshedAt)}` : ""
          }.`
          : "Repository index status unavailable."}
      </p>
      <p className="text-xs text-muted-foreground">
        Purge clears cached upstream file bytes only. Index data and artifact metadata are kept.
      </p>
      <DestructiveActionDialog
        open={purgeDialogOpen}
        onOpenChange={setPurgeDialogOpen}
        pending={purgeByteCache.isPending}
        error={purgeByteCache.isError ? purgeByteCache.error : undefined}
        title={`Purge ${label} byte cache`}
        description={[
          `This removes downloaded upstream file bytes cached for ${repository.name}.`,
          "Index data stays in place, and future downloads can cache files again.",
        ].join("\n")}
        confirmLabel="Purge cache"
        pendingLabel="Purging..."
        confirmationText={repository.name}
        onConfirm={confirmPurgeByteCache}
      />
    </div>
  );
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const digits = unitIndex === 0 || size >= 10 ? 0 : 1;
  return `${size.toFixed(digits)} ${units[unitIndex]}`;
}
