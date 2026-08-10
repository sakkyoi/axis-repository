import { Ban, Power, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { getRuntimeConfig } from "../runtime-config";
import {
  useRepositoryPlugins,
  useRuntimeSettings,
  useUpdateRepositoryPluginPolicy,
  useUpdateRuntimeSettings,
} from "../api/hooks";
import { BootstrapCredentialsCard } from "../components/bootstrap-credentials";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { HelpTrigger } from "../components/ui/help-trigger";
import { Input } from "../components/ui/input";
import { repositoryPluginStatusRows } from "../repositories/plugins/plugin-lifecycle";
import { repositoryKindLabel } from "../repositories/detail/repository-page-model";
import { ErrorState, PageShell } from "./shared";
import { SkeletonRows, SkeletonTableRows } from "../components/ui/skeleton";
import { useErrorToast, useToast } from "../components/ui/toast";

const repositoryPluginsTableColumns = "grid-cols-[minmax(180px,1fr)_130px_minmax(170px,0.8fr)_minmax(300px,1.3fr)_minmax(220px,1fr)_240px]";

export function SettingsPage() {
  const runtimeConfig = getRuntimeConfig();
  const apiTarget = runtimeConfig.apiBaseUrl || "same-origin";
  const repositoryPlugins = useRepositoryPlugins();
  const updatePluginPolicy = useUpdateRepositoryPluginPolicy();
  const runtimeSettings = useRuntimeSettings();
  const updateRuntimeSettings = useUpdateRuntimeSettings();
  useErrorToast("Plugin policy update failed", updatePluginPolicy.error);
  useErrorToast("Runtime settings update failed", updateRuntimeSettings.error);
  const pluginRows = repositoryPluginStatusRows(repositoryPlugins.data ?? []);
  const [confirmDisableEcosystem, setConfirmDisableEcosystem] = useState<string | null>(null);

  return (
    <PageShell
      title="Settings"
      description="Runtime details and repository plugin lifecycle for this admin console."
    >
      <div className="grid gap-3 rounded-lg border border-border bg-panel p-5 text-sm">
        <div className="flex items-center justify-between gap-4 border-b border-border pb-3">
          <span className="font-medium">API target</span>
          <span className="font-mono text-muted-foreground">{apiTarget}</span>
        </div>
        <div className="flex items-center justify-between gap-4 border-b border-border pb-3">
          <span className="font-medium">Auth storage</span>
          <span className="font-mono text-muted-foreground">memory access token + HttpOnly refresh cookie</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="font-medium">Config source</span>
          <span className="font-mono text-muted-foreground">window.__AXIS_ADMIN_CONFIG__</span>
        </div>
      </div>
      <BootstrapCredentialsCard />
      <RuntimeOperationalPolicyCard
        query={runtimeSettings}
        update={updateRuntimeSettings}
      />
      <section className="grid gap-3 rounded-lg border border-border bg-panel p-5">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">Repository plugins</h2>
            <RepositoryPluginAvailabilityHelp />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Static catalog lifecycle, runtime wiring, and admin UI support reported by this server.
          </p>
        </div>
        {repositoryPlugins.isLoading && (
          <div className="rounded-md border border-border">
            <SkeletonTableRows
              rows={3}
              columns={repositoryPluginsTableColumns}
              cells={["w-full", "w-20", "w-full", "w-full", "w-full", "w-28 justify-self-end"]}
              minWidth="min-w-[84rem]"
            />
          </div>
        )}
        {repositoryPlugins.error && <ErrorState title="Repository plugins unavailable" error={repositoryPlugins.error} />}
        {!repositoryPlugins.isLoading && !repositoryPlugins.error && pluginRows.length === 0 && (
          <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
            No repository plugins are reported by this server.
          </div>
        )}
        {pluginRows.length > 0 && (
          <div className="overflow-x-auto rounded-md border border-border" data-testid="repository-plugins-table-scroll-area">
            <div className="min-w-[84rem]" role="table" aria-label="Repository plugins">
              <div
                className={`grid ${repositoryPluginsTableColumns} gap-3 border-b border-border bg-muted px-3 py-2 text-xs font-semibold uppercase text-muted-foreground`}
                role="row"
              >
                <span role="columnheader">Plugin</span>
                <span role="columnheader">Status</span>
                <span role="columnheader">Policy</span>
                <span role="columnheader">Kinds / capabilities</span>
                <span role="columnheader">Client helpers</span>
                <span className="text-right" role="columnheader">Actions</span>
              </div>
              <div className="divide-y divide-border" role="rowgroup">
                {pluginRows.map((plugin) => (
                  <div
                    key={plugin.ecosystem}
                    className={`grid ${repositoryPluginsTableColumns} gap-3 px-3 py-3 text-sm`}
                    role="row"
                  >
                    <div className="min-w-0" role="cell">
                      <div className="font-medium">{plugin.name}</div>
                      <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                        {plugin.ecosystem} / {plugin.version}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {plugin.badges.map((badge) => (
                          <Badge key={badge.label} variant={badge.variant}>{badge.label}</Badge>
                        ))}
                      </div>
                    </div>
                    <div role="cell">
                      <Badge variant={plugin.lifecycle.variant}>{plugin.lifecycle.label}</Badge>
                      <p className="mt-2 text-xs text-muted-foreground">{plugin.lifecycle.description}</p>
                    </div>
                    <div className="min-w-0 text-xs" role="cell">
                      <div className="font-medium">{plugin.policySummary}</div>
                      <div className="mt-1 text-muted-foreground">{plugin.policySource}</div>
                      <div className="mt-1 text-muted-foreground">{plugin.policyDescription}</div>
                    </div>
                    <div className="grid min-w-0 content-start gap-2" role="cell">
                      <div className="grid gap-1.5">
                        <span className="text-[11px] font-semibold uppercase text-muted-foreground">Kinds</span>
                        <div className="flex flex-wrap gap-1.5">
                          {plugin.repositoryKinds.map((capability) => (
                            <Badge key={capability.kind} variant={capability.experimental ? "warning" : "default"}>
                              {repositoryKindLabel(capability.kind)}
                              {capability.experimental ? " experimental" : ""}
                            </Badge>
                          ))}
                        </div>
                      </div>
                      <div className="grid gap-1.5">
                        <span className="text-[11px] font-semibold uppercase text-muted-foreground">Capabilities</span>
                        <div className="flex flex-wrap gap-1.5">
                          {plugin.capabilities.map((capability) => (
                            <span key={capability} className="rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground">
                              {capability}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="break-words font-mono text-xs text-muted-foreground" role="cell">{plugin.clientHelperSummary}</div>
                    <div className="flex flex-wrap items-start justify-end gap-2" role="cell">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={updatePluginPolicy.isPending}
                        onClick={() => {
                          setConfirmDisableEcosystem(null);
                          updatePluginPolicy.mutate({ ecosystem: plugin.ecosystem, input: { enabled: true } });
                        }}
                      >
                        <Power className="mr-1.5 size-3.5" aria-hidden="true" />
                        Enable
                      </Button>
                      {confirmDisableEcosystem === plugin.ecosystem ? (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            disabled={updatePluginPolicy.isPending}
                            onClick={() => {
                              updatePluginPolicy.mutate({ ecosystem: plugin.ecosystem, input: { enabled: false } });
                              setConfirmDisableEcosystem(null);
                            }}
                          >
                            <Ban className="mr-1.5 size-3.5" aria-hidden="true" />
                            Confirm
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={updatePluginPolicy.isPending}
                            onClick={() => setConfirmDisableEcosystem(null)}
                          >
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={updatePluginPolicy.isPending}
                          onClick={() => setConfirmDisableEcosystem(plugin.ecosystem)}
                        >
                          <Ban className="mr-1.5 size-3.5" aria-hidden="true" />
                          Disable
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={updatePluginPolicy.isPending || !plugin.canResetPolicy}
                        onClick={() => {
                          setConfirmDisableEcosystem(null);
                          updatePluginPolicy.mutate({ ecosystem: plugin.ecosystem, input: { enabled: null } });
                        }}
                      >
                        <RotateCcw className="mr-1.5 size-3.5" aria-hidden="true" />
                        Reset
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>
    </PageShell>
  );
}

type RuntimeSettingsQuery = ReturnType<typeof useRuntimeSettings>;
type RuntimeSettingsUpdate = ReturnType<typeof useUpdateRuntimeSettings>;

interface RuntimePolicyFormState {
  upstreamFetchTimeoutMs: string;
  upstreamRequestRetries: string;
  upstreamRetryBaseDelayMs: string;
  upstreamRetryMaxDelayMs: string;
  indexCatalogBatchSize: string;
  indexProjectDetailBatchSize: string;
  failedProjectSampleLimit: string;
  fileByteCacheEnabled: boolean;
  fileByteCacheMaxBytes: string;
  fileByteCacheMaxTotalBytes: string;
  fileByteCacheTtlSeconds: string;
  respectUpstreamCacheControl: boolean;
}

function RuntimeOperationalPolicyCard({
  query,
  update,
}: {
  query: RuntimeSettingsQuery;
  update: RuntimeSettingsUpdate;
}) {
  const toast = useToast();
  const effective = query.data?.settings.operationalPolicy.proxy;
  const [form, setForm] = useState<RuntimePolicyFormState>(() => runtimePolicyFormState(effective));

  useEffect(() => {
    if (!effective) return;
    setForm(runtimePolicyFormState(effective));
  }, [effective]);

  return (
    <section className="grid gap-4 rounded-lg border border-border bg-panel p-5">
      <div>
        <h2 className="text-base font-semibold">Proxy runtime policy</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Global defaults for proxy repositories. Repository config can still override these values.
        </p>
      </div>
      {query.isLoading && (
        <div className="rounded-md border border-border">
          <SkeletonRows rows={2} columns={["w-40", "w-24", "w-32"]} />
        </div>
      )}
      {query.error && <ErrorState title="Runtime settings unavailable" error={query.error} />}
      {effective && (
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            update.mutate({
              operationalPolicy: {
                proxy: {
                  upstreamFetchTimeoutMs: integerFormValue(form.upstreamFetchTimeoutMs),
                  upstreamRequestRetries: integerFormValue(form.upstreamRequestRetries),
                  upstreamRetryBaseDelayMs: integerFormValue(form.upstreamRetryBaseDelayMs),
                  upstreamRetryMaxDelayMs: integerFormValue(form.upstreamRetryMaxDelayMs),
                  indexCatalogBatchSize: integerFormValue(form.indexCatalogBatchSize),
                  indexProjectDetailBatchSize: integerFormValue(form.indexProjectDetailBatchSize),
                  failedProjectSampleLimit: integerFormValue(form.failedProjectSampleLimit),
                  fileByteCache: {
                    enabled: form.fileByteCacheEnabled,
                    maxBytes: integerFormValue(form.fileByteCacheMaxBytes),
                    maxTotalBytes: integerFormValue(form.fileByteCacheMaxTotalBytes),
                    ttlSeconds: integerFormValue(form.fileByteCacheTtlSeconds),
                    respectUpstreamCacheControl: form.respectUpstreamCacheControl,
                  },
                },
              },
            }, {
              onSuccess: () => toast.notify({ title: "Runtime settings saved" }),
            });
          }}
        >
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <RuntimeNumberField
              label="Upstream timeout"
              suffix="ms"
              value={form.upstreamFetchTimeoutMs}
              onChange={(upstreamFetchTimeoutMs) => setForm((current) => ({ ...current, upstreamFetchTimeoutMs }))}
            />
            <RuntimeNumberField
              label="Catalog batch"
              value={form.indexCatalogBatchSize}
              onChange={(indexCatalogBatchSize) => setForm((current) => ({ ...current, indexCatalogBatchSize }))}
            />
            <RuntimeNumberField
              label="Project detail batch"
              value={form.indexProjectDetailBatchSize}
              onChange={(indexProjectDetailBatchSize) => setForm((current) => ({ ...current, indexProjectDetailBatchSize }))}
            />
            <RuntimeNumberField
              label="Failed samples"
              value={form.failedProjectSampleLimit}
              onChange={(failedProjectSampleLimit) => setForm((current) => ({ ...current, failedProjectSampleLimit }))}
            />
            <RuntimeNumberField
              label="Upstream retries"
              value={form.upstreamRequestRetries}
              onChange={(upstreamRequestRetries) => setForm((current) => ({ ...current, upstreamRequestRetries }))}
            />
            <RuntimeNumberField
              label="Retry base delay"
              suffix="ms"
              value={form.upstreamRetryBaseDelayMs}
              onChange={(upstreamRetryBaseDelayMs) => setForm((current) => ({ ...current, upstreamRetryBaseDelayMs }))}
            />
            <RuntimeNumberField
              label="Retry max delay"
              suffix="ms"
              value={form.upstreamRetryMaxDelayMs}
              onChange={(upstreamRetryMaxDelayMs) => setForm((current) => ({ ...current, upstreamRetryMaxDelayMs }))}
            />
            <RuntimeNumberField
              label="Byte cache limit"
              suffix="bytes"
              value={form.fileByteCacheMaxBytes}
              onChange={(fileByteCacheMaxBytes) => setForm((current) => ({ ...current, fileByteCacheMaxBytes }))}
            />
            <RuntimeNumberField
              label="Byte cache total"
              suffix="bytes"
              value={form.fileByteCacheMaxTotalBytes}
              onChange={(fileByteCacheMaxTotalBytes) => setForm((current) => ({ ...current, fileByteCacheMaxTotalBytes }))}
            />
            <RuntimeNumberField
              label="Byte cache TTL"
              suffix="seconds"
              value={form.fileByteCacheTtlSeconds}
              onChange={(fileByteCacheTtlSeconds) => setForm((current) => ({ ...current, fileByteCacheTtlSeconds }))}
            />
            <label className="flex min-h-16 items-center gap-3 rounded-md border border-border bg-background px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={form.fileByteCacheEnabled}
                onChange={(event) => setForm((current) => ({ ...current, fileByteCacheEnabled: event.target.checked }))}
              />
              <span>Enable byte cache</span>
            </label>
            <label className="flex min-h-16 items-center gap-3 rounded-md border border-border bg-background px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={form.respectUpstreamCacheControl}
                onChange={(event) => setForm((current) => ({ ...current, respectUpstreamCacheControl: event.target.checked }))}
              />
              <span>Respect upstream cache-control</span>
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={update.isPending}>
              Save
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={update.isPending}
              onClick={() => update.mutate({}, {
                onSuccess: (result) => {
                  setForm(runtimePolicyFormState(result.settings.operationalPolicy.proxy));
                  toast.notify({ title: "Runtime settings reset" });
                },
              })}
            >
              <RotateCcw className="mr-1.5 size-3.5" aria-hidden="true" />
              Reset overrides
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

function RuntimeNumberField({
  label,
  suffix,
  value,
  onChange,
}: {
  label: string;
  suffix?: string;
  value: string;
  onChange(value: string): void;
}) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="text-xs font-semibold uppercase text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={0}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
      </div>
    </label>
  );
}

function runtimePolicyFormState(
  policy: NonNullable<RuntimeSettingsQuery["data"]>["settings"]["operationalPolicy"]["proxy"] | undefined,
): RuntimePolicyFormState {
  return {
    upstreamFetchTimeoutMs: String(policy?.upstreamFetchTimeoutMs ?? ""),
    upstreamRequestRetries: String(policy?.upstreamRequestRetries ?? ""),
    upstreamRetryBaseDelayMs: String(policy?.upstreamRetryBaseDelayMs ?? ""),
    upstreamRetryMaxDelayMs: String(policy?.upstreamRetryMaxDelayMs ?? ""),
    indexCatalogBatchSize: String(policy?.indexCatalogBatchSize ?? ""),
    indexProjectDetailBatchSize: String(policy?.indexProjectDetailBatchSize ?? ""),
    failedProjectSampleLimit: String(policy?.failedProjectSampleLimit ?? ""),
    fileByteCacheEnabled: policy?.fileByteCache.enabled ?? true,
    fileByteCacheMaxBytes: String(policy?.fileByteCache.maxBytes ?? ""),
    fileByteCacheMaxTotalBytes: String(policy?.fileByteCache.maxTotalBytes ?? ""),
    fileByteCacheTtlSeconds: String(policy?.fileByteCache.ttlSeconds ?? ""),
    respectUpstreamCacheControl: policy?.fileByteCache.respectUpstreamCacheControl ?? true,
  };
}

function integerFormValue(value: string): number | undefined {
  if (!value.trim()) return undefined;
  return Number(value);
}

function RepositoryPluginAvailabilityHelp() {
  const description = "Repository plugin availability is resolved from the deployment catalog plus admin policy overrides stored by this Axis runtime.";

  return (
    <HelpTrigger label="Repository plugin availability help">
      {description}
    </HelpTrigger>
  );
}
