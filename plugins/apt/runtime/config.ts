import { ValidationError, type Repository } from "@axis-repository/core";
import { aptPluginManifest } from "../manifest";

export interface AptRepositoryConfig {
  codename: string;
  components?: string[];
  architectures?: string[];
  signingKeyId: string;
  /** Free-text `Release` identity; both default to the repository name. */
  origin?: string;
  label?: string;
  /** `Suite` when it differs from the codename, as in "stable" vs "bookworm". */
  suite?: string;
  description?: string;
  /** Days a signed `Release` stays valid; omitted means it never expires. */
  validityDays?: number;
  notAutomatic?: boolean;
  butAutomaticUpgrades?: boolean;
  acquireByHash?: boolean;
}

export interface AptResolvedRepositoryConfig extends AptRepositoryConfig {
  components: string[];
  architectures: string[];
}

const safePathSegmentPattern = /^[A-Za-z0-9][A-Za-z0-9._+~-]*$/;
// A newline in a free-text Release field would start a new field.
// eslint-disable-next-line no-control-regex
const controlCharacterPattern = /[\u0000-\u001F\u007F]/;
const aptConfigNamespace = aptPluginManifest.repositoryConfig.namespace;

export function parseAptRepositoryConfig(repository: Repository): AptRepositoryConfig {
  const aptConfig = readRecord(repository.config[aptConfigNamespace]);
  const codename = requiredConfigString(aptConfig, "codename");
  const components = optionalConfigStringArray(aptConfig, "components");
  const architectures = optionalConfigStringArray(aptConfig, "architectures");
  const notAutomatic = optionalConfigBoolean(aptConfig, "notAutomatic");
  const butAutomaticUpgrades = optionalConfigBoolean(aptConfig, "butAutomaticUpgrades");
  const acquireByHash = optionalConfigBoolean(aptConfig, "acquireByHash");

  if (butAutomaticUpgrades && !notAutomatic) {
    // apt only reads ButAutomaticUpgrades on a NotAutomatic suite; on its own
    // it silently does nothing, which looks like the pin was applied.
    throw new ValidationError(`${configPath("butAutomaticUpgrades")} requires ${configPath("notAutomatic")}`);
  }

  return {
    codename: validatePathSegment(codename, configPath("codename")),
    ...(components ? { components: components.map((component) => validatePathSegment(component, configPath("components"))) } : {}),
    ...(architectures
      ? { architectures: architectures.map((architecture) => validatePathSegment(architecture, configPath("architectures"))) }
      : {}),
    signingKeyId: validatePathSegment(
      requiredConfigString(aptConfig, "signingKeyId"),
      configPath("signingKeyId"),
    ),
    ...optionalReleaseText(aptConfig, "origin"),
    ...optionalReleaseText(aptConfig, "label"),
    ...optionalReleaseText(aptConfig, "suite"),
    ...optionalReleaseText(aptConfig, "description"),
    ...optionalPositiveInteger(aptConfig, "validityDays"),
    ...(notAutomatic !== undefined ? { notAutomatic } : {}),
    ...(butAutomaticUpgrades !== undefined ? { butAutomaticUpgrades } : {}),
    ...(acquireByHash !== undefined ? { acquireByHash } : {}),
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

function optionalReleaseText(config: Record<string, unknown>, field: string): Record<string, string> {
  if (!(field in config) || config[field] === undefined) {
    return {};
  }
  const value = config[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new ValidationError(`${configPath(field)} must be a non-empty string when provided`);
  }
  if (controlCharacterPattern.test(value)) {
    throw new ValidationError(`${configPath(field)} must not contain control characters`);
  }
  return { [field]: value };
}

function optionalPositiveInteger(config: Record<string, unknown>, field: string): Record<string, number> {
  if (!(field in config) || config[field] === undefined) {
    return {};
  }
  const value = config[field];
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new ValidationError(`${configPath(field)} must be a positive whole number when provided`);
  }
  return { [field]: value };
}

function optionalConfigBoolean(config: Record<string, unknown>, field: string): boolean | undefined {
  if (!(field in config) || config[field] === undefined) {
    return undefined;
  }
  const value = config[field];
  if (typeof value !== "boolean") {
    throw new ValidationError(`${configPath(field)} must be a boolean when provided`);
  }
  return value;
}

function optionalConfigStringArray(config: Record<string, unknown>, field: string): string[] | undefined {
  if (!(field in config)) {
    return undefined;
  }
  const value = config[field];
  if (!isConfigStringArray(value) || value.length === 0 || value.some((item) => item.length === 0)) {
    throw new ValidationError(`${configPath(field)} must be a non-empty string array when provided`);
  }
  return [...value];
}

function isConfigStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function configPath(field: string): string {
  return `config.${aptConfigNamespace}.${field}`;
}
