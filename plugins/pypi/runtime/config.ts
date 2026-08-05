import { ValidationError } from "@axis-repository/core";
import { pypiPluginManifest } from "../manifest";

export interface PypiProxyRepositoryConfig {
  upstreamUrl: string;
}

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

  return {
    upstreamUrl: ensureTrailingSlash(url.toString()),
  };
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}
