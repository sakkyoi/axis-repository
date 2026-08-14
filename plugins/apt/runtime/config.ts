import { ValidationError, type ProxyOperationalPolicyOverride, type Repository } from "@axis-repository/core";
import { aptPluginManifest } from "../manifest";

export interface AptRepositoryConfig {
  /** The default publish target, and the only suite unless `suites` says otherwise. */
  codename: string;
  /** Every suite this repository publishes; must contain `codename`. */
  suites?: string[];
  components?: string[];
  architectures?: string[];
  signing: AptHostedSigningPolicy;
  /** Free-text `Release` identity; both default to the repository name. */
  origin?: string;
  label?: string;
  /** `Suite` when it differs from the codename, as in "stable" vs "bookworm". */
  suite?: string;
  version?: string;
  description?: string;
  signedBy?: string[];
  noSupportForArchitectureAll?: string[];
  /** Days a signed `Release` stays valid; omitted means it never expires. */
  validityDays?: number;
  notAutomatic?: boolean;
  butAutomaticUpgrades?: boolean;
  acquireByHash?: boolean;
}

export interface AptResolvedRepositoryConfig extends AptRepositoryConfig {
  suites: string[];
  components: string[];
  architectures: string[];
}

export interface AptProxyRepositoryConfig {
  upstreamUrl: string;
  signing: AptProxySigningPolicy;
  codename: string;
  components?: string[];
  architectures?: string[];
  proxyPolicy?: ProxyOperationalPolicyOverride;
}

export type AptHostedSigningPolicy =
  | { mode: "axis"; signingKeyId: string }
  | { mode: "unsigned" };

export type AptProxySigningPolicy =
  | { mode: "upstream"; upstreamKeyUrl?: string }
  | { mode: "axis"; signingKeyId: string }
  | { mode: "unsigned" };

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
  const suites = optionalConfigStringArray(aptConfig, "suites")
    ?.map((suite) => validatePathSegment(suite, configPath("suites")));

  if (butAutomaticUpgrades && !notAutomatic) {
    // apt only reads ButAutomaticUpgrades on a NotAutomatic suite; on its own
    // it silently does nothing, which looks like the pin was applied.
    throw new ValidationError(`${configPath("butAutomaticUpgrades")} requires ${configPath("notAutomatic")}`);
  }
  if (suites && !suites.includes(codename)) {
    // codename is where a publish goes when it does not name a suite, so a
    // list that leaves it out would make every default publish fail.
    throw new ValidationError(`${configPath("suites")} must include ${configPath("codename")}`);
  }

  return {
    codename: validatePathSegment(codename, configPath("codename")),
    ...(suites ? { suites: [...new Set(suites)] } : {}),
    ...(components ? { components: components.map((component) => validatePathSegment(component, configPath("components"))) } : {}),
    ...(architectures
      ? { architectures: architectures.map((architecture) => validatePathSegment(architecture, configPath("architectures"))) }
      : {}),
    signing: parseHostedSigningPolicy(aptConfig),
    ...optionalReleaseText(aptConfig, "origin"),
    ...optionalReleaseText(aptConfig, "label"),
    ...suiteOverride(aptConfig, suites ?? [codename]),
    ...optionalReleaseText(aptConfig, "version"),
    ...optionalReleaseText(aptConfig, "description"),
    ...optionalSignedBy(aptConfig),
    ...optionalNoSupportForArchitectureAll(aptConfig),
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

export function parseAptProxyRepositoryConfig(config: Record<string, unknown>): AptProxyRepositoryConfig {
  const aptConfig = readRecord(config[aptConfigNamespace]);
  const upstreamUrl = requiredConfigString(aptConfig, "upstreamUrl");
  let url: URL;
  try {
    url = new URL(normalizeAptProxyUpstreamUrlInput(upstreamUrl));
  } catch {
    throw new ValidationError(`${configPath("upstreamUrl")} must be a valid URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ValidationError(`${configPath("upstreamUrl")} must use http or https`);
  }
  const signing = parseProxySigningPolicy(aptConfig);

  const codename = validatePathSegment(requiredConfigString(aptConfig, "codename"), configPath("codename"));
  const components = optionalConfigStringArray(aptConfig, "components")
    ?.map((component) => validatePathSegment(component, configPath("components")));
  const architectures = optionalConfigStringArray(aptConfig, "architectures")
    ?.map((architecture) => validatePathSegment(architecture, configPath("architectures")));
  const proxyPolicy = aptConfig.proxyPolicy;
  if (proxyPolicy !== undefined && (!proxyPolicy || typeof proxyPolicy !== "object" || Array.isArray(proxyPolicy))) {
    throw new ValidationError(`${configPath("proxyPolicy")} must be an object`);
  }

  return {
    upstreamUrl: ensureTrailingSlash(url.toString()),
    signing,
    codename,
    ...(components ? { components: [...new Set(components)] } : {}),
    ...(architectures ? { architectures: [...new Set(architectures)] } : {}),
    ...(proxyPolicy === undefined ? {} : { proxyPolicy: proxyPolicy as ProxyOperationalPolicyOverride }),
  };
}

export function normalizeAptProxyRepositoryConfig(config: Record<string, unknown>): Record<string, unknown> {
  return {
    [aptConfigNamespace]: parseAptProxyRepositoryConfig(config),
  };
}

function normalizeAptProxyUpstreamUrlInput(value: string): string {
  const trimmed = value.trim();
  return /^[a-z][a-z\d+.-]*:/iu.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function optionalHttpUrl(config: Record<string, unknown>, field: string, label = configPath(field)): string | undefined {
  if (!(field in config) || config[field] === undefined || config[field] === "") {
    return undefined;
  }
  const value = config[field];
  if (typeof value !== "string") {
    throw new ValidationError(`${label} must be a valid URL when provided`);
  }
  let url: URL;
  try {
    url = new URL(normalizeAptProxyUpstreamUrlInput(value));
  } catch {
    throw new ValidationError(`${label} must be a valid URL when provided`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ValidationError(`${label} must use http or https`);
  }
  return url.toString();
}

function parseHostedSigningPolicy(config: Record<string, unknown>): AptHostedSigningPolicy {
  const signing = readRecord(config.signing);
  const mode = signing.mode;
  if (mode === "axis") {
    return {
      mode,
      signingKeyId: validatePathSegment(requiredConfigString(signing, "signingKeyId"), configPath("signing.signingKeyId")),
    };
  }
  if (mode === "unsigned") {
    return { mode };
  }
  throw new ValidationError(`${configPath("signing.mode")} must be axis or unsigned`);
}

function parseProxySigningPolicy(config: Record<string, unknown>): AptProxySigningPolicy {
  const signing = readRecord(config.signing);
  const mode = signing.mode;
  if (mode === "upstream") {
    const upstreamKeyUrl = optionalHttpUrl(signing, "upstreamKeyUrl", configPath("signing.upstreamKeyUrl"));
    return {
      mode,
      ...(upstreamKeyUrl ? { upstreamKeyUrl } : {}),
    };
  }
  if (mode === "axis") {
    return {
      mode,
      signingKeyId: validatePathSegment(requiredConfigString(signing, "signingKeyId"), configPath("signing.signingKeyId")),
    };
  }
  if (mode === "unsigned") {
    return { mode };
  }
  throw new ValidationError(`${configPath("signing.mode")} must be upstream, axis, or unsigned`);
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
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

function optionalSignedBy(config: Record<string, unknown>): Record<string, string[]> {
  const values = optionalConfigStringArray(config, "signedBy");
  if (!values) {
    return {};
  }
  if (!values.every((value) => /^([A-Fa-f0-9]{40}|[A-Fa-f0-9]{64})!?$/.test(value))) {
    throw new ValidationError(`${configPath("signedBy")} must contain OpenPGP fingerprints`);
  }
  return { signedBy: [...new Set(values)] };
}

function optionalNoSupportForArchitectureAll(config: Record<string, unknown>): Record<string, string[]> {
  const values = optionalConfigStringArray(config, "noSupportForArchitectureAll");
  if (!values) {
    return {};
  }
  return {
    noSupportForArchitectureAll: [...new Set(values.map((value) =>
      validatePathSegment(value, configPath("noSupportForArchitectureAll")),
    ))],
  };
}

/**
 * Reads the `Suite:` override, which only makes sense for a single suite.
 *
 * Applying one name to every `dists/` tree would publish several suites that
 * all claim to be the same one, so a repository publishing more than one has
 * to let each `Release` name itself.
 */
function suiteOverride(config: Record<string, unknown>, suites: string[]): Record<string, string> {
  const override = optionalReleaseText(config, "suite");
  if (override.suite !== undefined && suites.length > 1) {
    throw new ValidationError(`${configPath("suite")} cannot be set when ${configPath("suites")} has more than one entry`);
  }
  return override;
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
