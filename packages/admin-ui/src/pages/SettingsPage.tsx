import { Ban, Power, RotateCcw } from "lucide-react";
import { useState } from "react";
import { getRuntimeConfig } from "../runtime-config";
import { useRepositoryPlugins, useUpdateRepositoryPluginPolicy } from "../api/hooks";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { HelpTrigger } from "../components/ui/help-trigger";
import { repositoryPluginStatusRows } from "../repositories/plugins/plugin-lifecycle";
import { ErrorState, PageShell } from "./shared";
import { useErrorToast } from "../components/ui/toast";

export function SettingsPage() {
  const runtimeConfig = getRuntimeConfig();
  const apiTarget = runtimeConfig.apiBaseUrl || "same-origin";
  const repositoryPlugins = useRepositoryPlugins();
  const updatePluginPolicy = useUpdateRepositoryPluginPolicy();
  useErrorToast("Plugin policy update failed", updatePluginPolicy.error);
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
          <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
            Loading repository plugins...
          </div>
        )}
        {repositoryPlugins.error && <ErrorState title="Repository plugins unavailable" error={repositoryPlugins.error} />}
        {!repositoryPlugins.isLoading && !repositoryPlugins.error && pluginRows.length === 0 && (
          <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
            No repository plugins are reported by this server.
          </div>
        )}
        {pluginRows.length > 0 && (
          <div className="overflow-x-auto rounded-md border border-border">
            <div className="min-w-[980px]">
              <div className="grid grid-cols-[minmax(140px,1fr)_120px_minmax(150px,0.8fr)_minmax(220px,1.3fr)_minmax(170px,1fr)_220px] border-b border-border bg-muted px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
                <span>Plugin</span>
                <span>Status</span>
                <span>Policy</span>
                <span>Capabilities</span>
                <span>Client helpers</span>
                <span>Actions</span>
              </div>
              <div className="divide-y divide-border">
                {pluginRows.map((plugin) => (
                  <div
                    key={plugin.ecosystem}
                    className="grid grid-cols-[minmax(140px,1fr)_120px_minmax(150px,0.8fr)_minmax(220px,1.3fr)_minmax(170px,1fr)_220px] gap-3 px-3 py-3 text-sm"
                  >
                    <div className="min-w-0">
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
                    <div>
                      <Badge variant={plugin.lifecycle.variant}>{plugin.lifecycle.label}</Badge>
                      <p className="mt-2 text-xs text-muted-foreground">{plugin.lifecycle.description}</p>
                    </div>
                    <div className="min-w-0 text-xs">
                      <div className="font-medium">{plugin.policySummary}</div>
                      <div className="mt-1 text-muted-foreground">{plugin.policySource}</div>
                      <div className="mt-1 text-muted-foreground">{plugin.policyDescription}</div>
                    </div>
                    <div className="flex min-w-0 flex-wrap content-start gap-1.5">
                      {plugin.capabilities.map((capability) => (
                        <span key={capability} className="rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground">
                          {capability}
                        </span>
                      ))}
                    </div>
                    <div className="break-words font-mono text-xs text-muted-foreground">{plugin.clientHelperSummary}</div>
                    <div className="flex flex-wrap items-start gap-2">
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

function RepositoryPluginAvailabilityHelp() {
  const description = "Repository plugin availability is resolved from the deployment catalog plus admin policy overrides stored by this Axis runtime.";

  return (
    <HelpTrigger label="Repository plugin availability help">
      {description}
    </HelpTrigger>
  );
}
