import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import {
  useRuntimeSettings,
  useUpdateRuntimeSettings,
} from "../api/hooks";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { SkeletonRows } from "../components/ui/skeleton";
import { useErrorToast, useToast } from "../components/ui/toast";
import { ErrorState } from "../pages/shared";

type RuntimeSettingsQuery = ReturnType<typeof useRuntimeSettings>;

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

export function RuntimePolicySettings() {
  const query = useRuntimeSettings();
  const update = useUpdateRuntimeSettings();
  const toast = useToast();
  useErrorToast("Runtime settings update failed", update.error);
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
          <div className="grid grid-cols-1 divide-y divide-border rounded-md border border-border" data-testid="proxy-runtime-policy-fields">
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
            <label className="grid min-h-12 items-center gap-3 px-3 py-2 text-sm sm:grid-cols-[minmax(220px,0.5fr)_minmax(0,1fr)]">
              <span className="font-medium">Enable byte cache</span>
              <input
                className="justify-self-start sm:justify-self-end"
                type="checkbox"
                checked={form.fileByteCacheEnabled}
                onChange={(event) => setForm((current) => ({ ...current, fileByteCacheEnabled: event.target.checked }))}
              />
            </label>
            <label className="grid min-h-12 items-center gap-3 px-3 py-2 text-sm sm:grid-cols-[minmax(220px,0.5fr)_minmax(0,1fr)]">
              <span className="font-medium">Respect upstream cache-control</span>
              <input
                className="justify-self-start sm:justify-self-end"
                type="checkbox"
                checked={form.respectUpstreamCacheControl}
                onChange={(event) => setForm((current) => ({ ...current, respectUpstreamCacheControl: event.target.checked }))}
              />
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
    <label className="grid min-h-12 items-center gap-3 px-3 py-2 text-sm sm:grid-cols-[minmax(220px,0.5fr)_minmax(0,1fr)]">
      <span className="font-medium">{label}</span>
      <div className="min-w-0 sm:flex sm:justify-end">
        <div className="relative w-full sm:max-w-72">
          <Input
            className={suffix ? "pr-16" : undefined}
            data-testid={`runtime-number-field-${fieldTestId(label)}`}
            type="number"
            min={0}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
          {suffix && (
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
              {suffix}
            </span>
          )}
        </div>
      </div>
    </label>
  );
}

function fieldTestId(label: string): string {
  return label.toLowerCase().replaceAll(" ", "-");
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
