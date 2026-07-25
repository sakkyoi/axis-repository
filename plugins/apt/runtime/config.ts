import { ValidationError, type Repository } from "@axis-repository/core";
import { aptPluginManifest } from "../manifest";

export interface AptRepositoryConfig {
  codename: string;
  components?: string[];
  architectures?: string[];
  signingKeyId: string;
}

export interface AptResolvedRepositoryConfig extends AptRepositoryConfig {
  components: string[];
  architectures: string[];
}

const safePathSegmentPattern = /^[A-Za-z0-9][A-Za-z0-9._+~-]*$/;
const aptConfigNamespace = aptPluginManifest.repositoryConfig.namespace;

export function parseAptRepositoryConfig(repository: Repository): AptRepositoryConfig {
  const aptConfig = readRecord(repository.config[aptConfigNamespace]);
  const codename = requiredConfigString(aptConfig, "codename");
  const components = optionalConfigStringArray(aptConfig, "components");
  const architectures = optionalConfigStringArray(aptConfig, "architectures");

  return {
    codename: validatePathSegment(codename, configPath("codename")),
    ...(components ? { components: components.map((component) => validatePathSegment(component, configPath("components"))) } : {}),
    ...(architectures
      ? { architectures: architectures.map((architecture) => validatePathSegment(architecture, configPath("architectures"))) }
      : {}),
    signingKeyId: requiredConfigString(aptConfig, "signingKeyId"),
  };
}

export function validatePathSegment(value: string, label: string): string {
  if (!safePathSegmentPattern.test(value) || value === "." || value === "..") {
    throw new ValidationError(`${label} contains unsafe path characters`);
  }
  return value;
}

function readRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function requiredConfigString(config: Record<string, unknown>, field: string): string {
  const value = config[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new ValidationError(`${configPath(field)} is required`);
  }
  return value;
}

function optionalConfigStringArray(config: Record<string, unknown>, field: string): string[] | undefined {
  if (!(field in config)) {
    return undefined;
  }
  const value = config[field];
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new ValidationError(`${configPath(field)} must be a non-empty string array when provided`);
  }
  return [...value];
}

function configPath(field: string): string {
  return `config.${aptConfigNamespace}.${field}`;
}
