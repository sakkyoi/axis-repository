import type { RuntimeSettingsRecord } from "../domain/domain";
import { ValidationError } from "../domain/errors";
import type { StateStore } from "../ports/ports";

export interface ProxyFileByteCachePolicy {
  enabled: boolean;
  maxBytes: number;
  maxTotalBytes: number;
  ttlSeconds: number;
  respectUpstreamCacheControl: boolean;
}

export interface ProxyOperationalPolicy {
  upstreamFetchTimeoutMs: number;
  upstreamRequestRetries: number;
  upstreamRetryBaseDelayMs: number;
  upstreamRetryMaxDelayMs: number;
  indexCatalogBatchSize: number;
  indexProjectDetailBatchSize: number;
  failedProjectSampleLimit: number;
  fileByteCache: ProxyFileByteCachePolicy;
}

export type ProxyOperationalPolicyOverride = Partial<Omit<ProxyOperationalPolicy, "fileByteCache">> & {
  fileByteCache?: Partial<ProxyFileByteCachePolicy>;
};

export interface RuntimeOperationalPolicySettings {
  proxy?: ProxyOperationalPolicyOverride;
}

export interface RuntimeSettings {
  operationalPolicy: {
    proxy: ProxyOperationalPolicy;
  };
}

export type OperationalPolicySource = "default" | "deployment" | "global" | "repository";

export interface ResolvedPolicyValue<T> {
  value: T;
  source: OperationalPolicySource;
}

export interface ResolvedProxyOperationalPolicy {
  upstreamFetchTimeoutMs: ResolvedPolicyValue<number>;
  upstreamRequestRetries: ResolvedPolicyValue<number>;
  upstreamRetryBaseDelayMs: ResolvedPolicyValue<number>;
  upstreamRetryMaxDelayMs: ResolvedPolicyValue<number>;
  indexCatalogBatchSize: ResolvedPolicyValue<number>;
  indexProjectDetailBatchSize: ResolvedPolicyValue<number>;
  failedProjectSampleLimit: ResolvedPolicyValue<number>;
  fileByteCache: {
    enabled: ResolvedPolicyValue<boolean>;
    maxBytes: ResolvedPolicyValue<number>;
    maxTotalBytes: ResolvedPolicyValue<number>;
    ttlSeconds: ResolvedPolicyValue<number>;
    respectUpstreamCacheControl: ResolvedPolicyValue<boolean>;
  };
}

export const DEFAULT_PROXY_OPERATIONAL_POLICY: ProxyOperationalPolicy = {
  upstreamFetchTimeoutMs: 2000,
  upstreamRequestRetries: 2,
  upstreamRetryBaseDelayMs: 250,
  upstreamRetryMaxDelayMs: 2000,
  indexCatalogBatchSize: 100,
  indexProjectDetailBatchSize: 25,
  failedProjectSampleLimit: 10,
  fileByteCache: {
    enabled: true,
    maxBytes: 512 * 1024 * 1024,
    maxTotalBytes: 0,
    ttlSeconds: 0,
    respectUpstreamCacheControl: true,
  },
};

const NUMERIC_POLICY_LIMITS = {
  upstreamFetchTimeoutMs: { min: 100, max: 60_000 },
  upstreamRequestRetries: { min: 0, max: 10 },
  upstreamRetryBaseDelayMs: { min: 0, max: 60_000 },
  upstreamRetryMaxDelayMs: { min: 0, max: 10 * 60_000 },
  indexCatalogBatchSize: { min: 1, max: 10_000 },
  indexProjectDetailBatchSize: { min: 1, max: 1_000 },
  failedProjectSampleLimit: { min: 0, max: 1_000 },
  fileByteCacheMaxBytes: { min: 0, max: 50 * 1024 * 1024 * 1024 },
  fileByteCacheMaxTotalBytes: { min: 0, max: 500 * 1024 * 1024 * 1024 },
  fileByteCacheTtlSeconds: { min: 0, max: 365 * 24 * 60 * 60 },
};

export interface RuntimeSettingsServiceOptions {
  state: StateStore;
  deploymentOperationalPolicy?: RuntimeOperationalPolicySettings;
}

export class RuntimeSettingsService {
  constructor(private readonly options: RuntimeSettingsServiceOptions) {}

  async get(): Promise<RuntimeSettings> {
    const stored = await this.options.state.runtimeSettings.get();
    const deployment = this.options.deploymentOperationalPolicy?.proxy;
    const global = stored?.operationalPolicy?.proxy;
    return {
      operationalPolicy: {
        proxy: flattenResolvedProxyOperationalPolicy(resolveProxyOperationalPolicy({
          ...(deployment === undefined ? {} : { deployment }),
          ...(global === undefined ? {} : { global }),
        })),
      },
    };
  }

  async getRecord(): Promise<RuntimeSettingsRecord> {
    return (await this.options.state.runtimeSettings.get()) ?? {};
  }

  async update(input: RuntimeSettingsRecord): Promise<RuntimeSettingsRecord> {
    const next: RuntimeSettingsRecord = {
      operationalPolicy: {
        proxy: validateProxyOperationalPolicyOverride(input.operationalPolicy?.proxy ?? {}),
      },
    };
    await this.options.state.runtimeSettings.save(next);
    return next;
  }
}

export function resolveProxyOperationalPolicy(input: {
  deployment?: ProxyOperationalPolicyOverride;
  global?: ProxyOperationalPolicyOverride;
  repository?: ProxyOperationalPolicyOverride;
} = {}): ResolvedProxyOperationalPolicy {
  const defaultPolicy = DEFAULT_PROXY_OPERATIONAL_POLICY;
  return {
    upstreamFetchTimeoutMs: resolveNumberPolicyValue("upstreamFetchTimeoutMs", defaultPolicy.upstreamFetchTimeoutMs, input),
    upstreamRequestRetries: resolveNumberPolicyValue("upstreamRequestRetries", defaultPolicy.upstreamRequestRetries, input),
    upstreamRetryBaseDelayMs: resolveNumberPolicyValue("upstreamRetryBaseDelayMs", defaultPolicy.upstreamRetryBaseDelayMs, input),
    upstreamRetryMaxDelayMs: resolveNumberPolicyValue("upstreamRetryMaxDelayMs", defaultPolicy.upstreamRetryMaxDelayMs, input),
    indexCatalogBatchSize: resolveNumberPolicyValue("indexCatalogBatchSize", defaultPolicy.indexCatalogBatchSize, input),
    indexProjectDetailBatchSize: resolveNumberPolicyValue("indexProjectDetailBatchSize", defaultPolicy.indexProjectDetailBatchSize, input),
    failedProjectSampleLimit: resolveNumberPolicyValue("failedProjectSampleLimit", defaultPolicy.failedProjectSampleLimit, input),
    fileByteCache: {
      enabled: resolveBooleanPolicyValue("enabled", defaultPolicy.fileByteCache.enabled, input),
      maxBytes: resolveNumberPolicyValue("fileByteCacheMaxBytes", defaultPolicy.fileByteCache.maxBytes, input),
      maxTotalBytes: resolveNumberPolicyValue("fileByteCacheMaxTotalBytes", defaultPolicy.fileByteCache.maxTotalBytes, input),
      ttlSeconds: resolveNumberPolicyValue("fileByteCacheTtlSeconds", defaultPolicy.fileByteCache.ttlSeconds, input),
      respectUpstreamCacheControl: resolveBooleanPolicyValue(
        "respectUpstreamCacheControl",
        defaultPolicy.fileByteCache.respectUpstreamCacheControl,
        input,
      ),
    },
  };
}

export function flattenResolvedProxyOperationalPolicy(resolved: ResolvedProxyOperationalPolicy): ProxyOperationalPolicy {
  return {
    upstreamFetchTimeoutMs: resolved.upstreamFetchTimeoutMs.value,
    upstreamRequestRetries: resolved.upstreamRequestRetries.value,
    upstreamRetryBaseDelayMs: resolved.upstreamRetryBaseDelayMs.value,
    upstreamRetryMaxDelayMs: resolved.upstreamRetryMaxDelayMs.value,
    indexCatalogBatchSize: resolved.indexCatalogBatchSize.value,
    indexProjectDetailBatchSize: resolved.indexProjectDetailBatchSize.value,
    failedProjectSampleLimit: resolved.failedProjectSampleLimit.value,
    fileByteCache: {
      enabled: resolved.fileByteCache.enabled.value,
      maxBytes: resolved.fileByteCache.maxBytes.value,
      maxTotalBytes: resolved.fileByteCache.maxTotalBytes.value,
      ttlSeconds: resolved.fileByteCache.ttlSeconds.value,
      respectUpstreamCacheControl: resolved.fileByteCache.respectUpstreamCacheControl.value,
    },
  };
}

export function validateRuntimeSettingsRecord(record: RuntimeSettingsRecord): RuntimeSettingsRecord {
  return {
    operationalPolicy: {
      proxy: validateProxyOperationalPolicyOverride(record.operationalPolicy?.proxy ?? {}),
    },
  };
}

function validateProxyOperationalPolicyOverride(input: ProxyOperationalPolicyOverride): ProxyOperationalPolicyOverride {
  return {
    ...(input.upstreamFetchTimeoutMs === undefined ? {} : {
      upstreamFetchTimeoutMs: assertPolicyInteger(
        input.upstreamFetchTimeoutMs,
        "operationalPolicy.proxy.upstreamFetchTimeoutMs",
        NUMERIC_POLICY_LIMITS.upstreamFetchTimeoutMs,
      ),
    }),
    ...(input.upstreamRequestRetries === undefined ? {} : {
      upstreamRequestRetries: assertPolicyInteger(
        input.upstreamRequestRetries,
        "operationalPolicy.proxy.upstreamRequestRetries",
        NUMERIC_POLICY_LIMITS.upstreamRequestRetries,
      ),
    }),
    ...(input.upstreamRetryBaseDelayMs === undefined ? {} : {
      upstreamRetryBaseDelayMs: assertPolicyInteger(
        input.upstreamRetryBaseDelayMs,
        "operationalPolicy.proxy.upstreamRetryBaseDelayMs",
        NUMERIC_POLICY_LIMITS.upstreamRetryBaseDelayMs,
      ),
    }),
    ...(input.upstreamRetryMaxDelayMs === undefined ? {} : {
      upstreamRetryMaxDelayMs: assertPolicyInteger(
        input.upstreamRetryMaxDelayMs,
        "operationalPolicy.proxy.upstreamRetryMaxDelayMs",
        NUMERIC_POLICY_LIMITS.upstreamRetryMaxDelayMs,
      ),
    }),
    ...(input.indexCatalogBatchSize === undefined ? {} : {
      indexCatalogBatchSize: assertPolicyInteger(
        input.indexCatalogBatchSize,
        "operationalPolicy.proxy.indexCatalogBatchSize",
        NUMERIC_POLICY_LIMITS.indexCatalogBatchSize,
      ),
    }),
    ...(input.indexProjectDetailBatchSize === undefined ? {} : {
      indexProjectDetailBatchSize: assertPolicyInteger(
        input.indexProjectDetailBatchSize,
        "operationalPolicy.proxy.indexProjectDetailBatchSize",
        NUMERIC_POLICY_LIMITS.indexProjectDetailBatchSize,
      ),
    }),
    ...(input.failedProjectSampleLimit === undefined ? {} : {
      failedProjectSampleLimit: assertPolicyInteger(
        input.failedProjectSampleLimit,
        "operationalPolicy.proxy.failedProjectSampleLimit",
        NUMERIC_POLICY_LIMITS.failedProjectSampleLimit,
      ),
    }),
    ...(input.fileByteCache === undefined ? {} : { fileByteCache: validateProxyFileByteCacheOverride(input.fileByteCache) }),
  };
}

function validateProxyFileByteCacheOverride(input: Partial<ProxyFileByteCachePolicy>): Partial<ProxyFileByteCachePolicy> {
  return {
    ...(input.enabled === undefined ? {} : { enabled: assertPolicyBoolean(input.enabled, "operationalPolicy.proxy.fileByteCache.enabled") }),
    ...(input.maxBytes === undefined ? {} : {
      maxBytes: assertPolicyInteger(
        input.maxBytes,
        "operationalPolicy.proxy.fileByteCache.maxBytes",
        NUMERIC_POLICY_LIMITS.fileByteCacheMaxBytes,
      ),
    }),
    ...(input.maxTotalBytes === undefined ? {} : {
      maxTotalBytes: assertPolicyInteger(
        input.maxTotalBytes,
        "operationalPolicy.proxy.fileByteCache.maxTotalBytes",
        NUMERIC_POLICY_LIMITS.fileByteCacheMaxTotalBytes,
      ),
    }),
    ...(input.ttlSeconds === undefined ? {} : {
      ttlSeconds: assertPolicyInteger(
        input.ttlSeconds,
        "operationalPolicy.proxy.fileByteCache.ttlSeconds",
        NUMERIC_POLICY_LIMITS.fileByteCacheTtlSeconds,
      ),
    }),
    ...(input.respectUpstreamCacheControl === undefined ? {} : {
      respectUpstreamCacheControl: assertPolicyBoolean(
        input.respectUpstreamCacheControl,
        "operationalPolicy.proxy.fileByteCache.respectUpstreamCacheControl",
      ),
    }),
  };
}

function resolveNumberPolicyValue(
  key: keyof Omit<ProxyOperationalPolicy, "fileByteCache">
    | "fileByteCacheMaxBytes"
    | "fileByteCacheMaxTotalBytes"
    | "fileByteCacheTtlSeconds",
  defaultValue: number,
  input: {
    deployment?: ProxyOperationalPolicyOverride;
    global?: ProxyOperationalPolicyOverride;
    repository?: ProxyOperationalPolicyOverride;
  },
): ResolvedPolicyValue<number> {
  return resolvePolicyValue(defaultValue, [
    ["deployment", policyNumberValue(input.deployment, key)],
    ["global", policyNumberValue(input.global, key)],
    ["repository", policyNumberValue(input.repository, key)],
  ]);
}

function resolveBooleanPolicyValue(
  key: keyof Pick<ProxyFileByteCachePolicy, "enabled" | "respectUpstreamCacheControl">,
  defaultValue: boolean,
  input: {
    deployment?: ProxyOperationalPolicyOverride;
    global?: ProxyOperationalPolicyOverride;
    repository?: ProxyOperationalPolicyOverride;
  },
): ResolvedPolicyValue<boolean> {
  return resolvePolicyValue(defaultValue, [
    ["deployment", input.deployment?.fileByteCache?.[key]],
    ["global", input.global?.fileByteCache?.[key]],
    ["repository", input.repository?.fileByteCache?.[key]],
  ]);
}

function resolvePolicyValue<T>(
  defaultValue: T,
  values: Array<[OperationalPolicySource, T | undefined]>,
): ResolvedPolicyValue<T> {
  let resolved: ResolvedPolicyValue<T> = { value: defaultValue, source: "default" };
  for (const [source, value] of values) {
    if (value !== undefined) {
      resolved = { value, source };
    }
  }
  return resolved;
}

function policyNumberValue(
  input: ProxyOperationalPolicyOverride | undefined,
  key: keyof Omit<ProxyOperationalPolicy, "fileByteCache">
    | "fileByteCacheMaxBytes"
    | "fileByteCacheMaxTotalBytes"
    | "fileByteCacheTtlSeconds",
): number | undefined {
  if (key === "fileByteCacheMaxBytes") return input?.fileByteCache?.maxBytes;
  if (key === "fileByteCacheMaxTotalBytes") return input?.fileByteCache?.maxTotalBytes;
  if (key === "fileByteCacheTtlSeconds") return input?.fileByteCache?.ttlSeconds;
  return input?.[key];
}

function assertPolicyInteger(value: unknown, label: string, limit: { min: number; max: number }): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < limit.min || value > limit.max) {
    throw new ValidationError(`${label} must be an integer between ${limit.min} and ${limit.max}`);
  }
  return value;
}

function assertPolicyBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new ValidationError(`${label} must be a boolean`);
  }
  return value;
}
