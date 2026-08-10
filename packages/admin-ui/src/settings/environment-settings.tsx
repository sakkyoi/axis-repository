import { BootstrapCredentialsCard } from "../components/bootstrap-credentials";
import { getRuntimeConfig } from "../runtime-config";

export function EnvironmentSettings() {
  const runtimeConfig = getRuntimeConfig();
  const apiTarget = runtimeConfig.apiBaseUrl || "same-origin";

  return (
    <div className="grid gap-5">
      <section className="grid gap-3 rounded-lg border border-border bg-panel p-5 text-sm">
        <div>
          <h2 className="text-base font-semibold">Environment</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Read-only runtime facts for checking what this admin console is connected to.
          </p>
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-border pt-3">
          <span className="font-medium">API target</span>
          <span className="font-mono text-muted-foreground">{apiTarget}</span>
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-border pt-3">
          <span className="font-medium">Config source</span>
          <span className="font-mono text-muted-foreground">window.__AXIS_ADMIN_CONFIG__</span>
        </div>
      </section>
      <BootstrapCredentialsCard />
    </div>
  );
}
