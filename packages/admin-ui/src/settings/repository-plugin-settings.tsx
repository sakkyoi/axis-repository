import { useState } from "react";
import { Ban, Power, RotateCcw } from "lucide-react";
import {
  useRepositoryPlugins,
  useUpdateRepositoryPluginPolicy,
} from "../api/hooks";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { HelpTrigger } from "../components/ui/help-trigger";
import { SkeletonTableRows } from "../components/ui/skeleton";
import { useErrorToast } from "../components/ui/toast";
import { repositoryKindLabel } from "../repositories/detail/repository-page-model";
import { repositoryPluginStatusRows } from "../repositories/plugins/plugin-lifecycle";
import { ErrorState } from "../pages/shared";

const repositoryPluginsTableColumns = "grid-cols-[minmax(180px,1fr)_130px_minmax(170px,0.8fr)_minmax(300px,1.3fr)_minmax(220px,1fr)_240px]";

export function RepositoryPluginSettings() {
  const repositoryPlugins = useRepositoryPlugins();
  const updatePluginPolicy = useUpdateRepositoryPluginPolicy();
  useErrorToast("Plugin policy update failed", updatePluginPolicy.error);
  const pluginRows = repositoryPluginStatusRows(repositoryPlugins.data ?? []);
  const [confirmDisableEcosystem, setConfirmDisableEcosystem] = useState<string | null>(null);

  return (
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
