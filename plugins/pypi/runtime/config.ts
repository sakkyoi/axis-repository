import { ValidationError, type ProxyOperationalPolicyOverride } from "@axis-repository/core";
import { pypiPluginManifest } from "../manifest";

export interface PypiProxyRepositoryConfig {
  upstreamUrl: string;
  upstreamUrlMode: PypiProxyUpstreamUrlMode;
  proxyPolicy?: ProxyOperationalPolicyOverride;
}

export type PypiProxyUpstreamUrlMode = "base-url" | "simple-api-root";

export function validatePypiRepositoryConfig(config: Record<string, unknown>): void {
  const namespace = pypiPluginManifest.repositoryConfig.namespace;
  const pypi = config[namespace];
  if (pypi !== undefined && (!pypi || typeof pypi !== "object" || Array.isArray(pypi))) {
    throw new ValidationError(`config.${namespace} must be an object`);
  }
}

export function parsePypiProxyRepositoryConfig(config: Record<string, unknown>): PypiProxyRepositoryConfig {
  validatePypiRepositoryConfig(config);
  const namespace = pypiPluginManifest.repositoryConfig.namespace;
  const pypi = config[namespace] as Record<string, unknown> | undefined;
  const upstreamUrl = pypi?.upstreamUrl;
  if (typeof upstreamUrl !== "string" || upstreamUrl.trim() === "") {
    throw new ValidationError(`config.${namespace}.upstreamUrl is required`);
  }

  let url: URL;
  try {
    url = new URL(upstreamUrl.trim());
  } catch {
    throw new ValidationError(`config.${namespace}.upstreamUrl must be a valid URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ValidationError(`config.${namespace}.upstreamUrl must use http or https`);
  }
  const upstreamUrlMode = pypi?.upstreamUrlMode;
  if (typeof upstreamUrlMode !== "string" || upstreamUrlMode.trim() === "") {
    throw new ValidationError(`config.${namespace}.upstreamUrlMode is required`);
  }
  if (!isPypiProxyUpstreamUrlMode(upstreamUrlMode)) {
    throw new ValidationError(`config.${namespace}.upstreamUrlMode must be base-url or simple-api-root`);
  }
  const proxyPolicy = pypi?.proxyPolicy;
  if (proxyPolicy !== undefined && (!proxyPolicy || typeof proxyPolicy !== "object" || Array.isArray(proxyPolicy))) {
    throw new ValidationError(`config.${namespace}.proxyPolicy must be an object`);
  }

  return {
    upstreamUrl: ensureTrailingSlash(url.toString()),
    upstreamUrlMode,
    ...(proxyPolicy === undefined ? {} : { proxyPolicy: proxyPolicy as ProxyOperationalPolicyOverride }),
  };
}

export function normalizePypiProxyRepositoryConfig(config: Record<string, unknown>): Record<string, unknown> {
  const namespace = pypiPluginManifest.repositoryConfig.namespace;
  const parsed = parsePypiProxyRepositoryConfig(config);
  return {
    [namespace]: parsed,
  };
}

export function isPypiProxyUpstreamUrlMode(value: unknown): value is PypiProxyUpstreamUrlMode {
  return value === "base-url" || value === "simple-api-root";
}

export function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}
