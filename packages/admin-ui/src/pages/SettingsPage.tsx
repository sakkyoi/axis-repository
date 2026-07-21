import { getRuntimeConfig } from "../runtime-config";

export function SettingsPage() {
  const runtimeConfig = getRuntimeConfig();
  const apiTarget = runtimeConfig.apiBaseUrl || "same-origin";

  return (
    <section className="grid max-w-3xl gap-5">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Runtime details for this admin console.
        </p>
      </div>
      <div className="grid gap-3 rounded-lg border border-border bg-panel p-5 text-sm">
        <div className="flex items-center justify-between gap-4 border-b border-border pb-3">
          <span className="font-medium">API target</span>
          <span className="font-mono text-muted-foreground">{apiTarget}</span>
        </div>
        <div className="flex items-center justify-between gap-4 border-b border-border pb-3">
          <span className="font-medium">Auth storage</span>
          <span className="font-mono text-muted-foreground">sessionStorage</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="font-medium">Config source</span>
          <span className="font-mono text-muted-foreground">window.__AXIS_ADMIN_CONFIG__</span>
        </div>
      </div>
    </section>
  );
}
