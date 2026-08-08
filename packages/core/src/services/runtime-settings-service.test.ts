import { describe, expect, it } from "vitest";
import { ValidationError } from "../domain/errors";
import { MemoryStateStore } from "../state/memory-state";
import {
  DEFAULT_PROXY_OPERATIONAL_POLICY,
  RuntimeSettingsService,
  resolveProxyOperationalPolicy,
} from "./runtime-settings-service";

describe("RuntimeSettingsService", () => {
  it("returns defaults when no runtime settings have been stored", async () => {
    const service = new RuntimeSettingsService({ state: new MemoryStateStore() });

    await expect(service.get()).resolves.toEqual({
      operationalPolicy: {
        proxy: DEFAULT_PROXY_OPERATIONAL_POLICY,
      },
    });
  });

  it("stores partial operational policy overrides", async () => {
    const service = new RuntimeSettingsService({ state: new MemoryStateStore() });

    await service.update({
      operationalPolicy: {
        proxy: {
          upstreamFetchTimeoutMs: 5000,
          upstreamRequestRetries: 2,
          upstreamRetryBaseDelayMs: 250,
          upstreamRetryMaxDelayMs: 1000,
          fileByteCache: {
            enabled: false,
            maxBytes: 1024,
            maxTotalBytes: 4096,
            ttlSeconds: 60,
            respectUpstreamCacheControl: false,
          },
        },
      },
    });

    await expect(service.get()).resolves.toMatchObject({
      operationalPolicy: {
        proxy: {
          upstreamFetchTimeoutMs: 5000,
          upstreamRequestRetries: 2,
          upstreamRetryBaseDelayMs: 250,
          upstreamRetryMaxDelayMs: 1000,
          indexCatalogBatchSize: DEFAULT_PROXY_OPERATIONAL_POLICY.indexCatalogBatchSize,
          fileByteCache: {
            enabled: false,
            maxBytes: 1024,
            maxTotalBytes: 4096,
            ttlSeconds: 60,
            respectUpstreamCacheControl: false,
          },
        },
      },
    });
  });

  it("rejects invalid runtime settings", async () => {
    const service = new RuntimeSettingsService({ state: new MemoryStateStore() });

    await expect(service.update({
      operationalPolicy: {
        proxy: {
          upstreamFetchTimeoutMs: 0,
        },
      },
    })).rejects.toThrow(ValidationError);
  });
});

describe("resolveProxyOperationalPolicy", () => {
  it("resolves repository over global over deployment over code defaults", () => {
    const resolved = resolveProxyOperationalPolicy({
      deployment: {
        upstreamFetchTimeoutMs: 3000,
        fileByteCache: { maxBytes: 10 },
      },
      global: {
        upstreamFetchTimeoutMs: 4000,
        fileByteCache: { enabled: false },
      },
      repository: {
        fileByteCache: { maxBytes: 20 },
      },
    });

    expect(resolved.upstreamFetchTimeoutMs).toEqual({ value: 4000, source: "global" });
    expect(resolved.fileByteCache.enabled).toEqual({ value: false, source: "global" });
    expect(resolved.fileByteCache.maxBytes).toEqual({ value: 20, source: "repository" });
    expect(resolved.fileByteCache.ttlSeconds).toEqual({
      value: DEFAULT_PROXY_OPERATIONAL_POLICY.fileByteCache.ttlSeconds,
      source: "default",
    });
    expect(resolved.indexCatalogBatchSize).toEqual({
      value: DEFAULT_PROXY_OPERATIONAL_POLICY.indexCatalogBatchSize,
      source: "default",
    });
  });
});
