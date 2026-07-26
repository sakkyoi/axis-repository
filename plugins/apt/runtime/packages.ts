import {
  ValidationError,
  type PublishArtifactRequest,
  type Repository,
} from "@axis-repository/core";
import { formatStanza, stanzaField, type DebianStanza } from "../shared/stanza";
import {
  parseAptRepositoryConfig,
  validatePathSegment,
  type AptRepositoryConfig,
  type AptResolvedRepositoryConfig,
} from "./config";

export interface AptPoolCopy {
  sourceKey: string;
  destinationKey: string;
  contentType: string;
}

export interface AptPackageIndex {
  component: string;
  architecture: string;
  relativePath: string;
  relativeGzPath: string;
  packagesPath: string;
  packagesGzPath: string;
  packages: string;
  packagesGz: Uint8Array;
}

export interface ValidatedAptArtifact {
  artifact: PublishArtifactRequest;
  packageName: string;
  version: string;
  architecture: string;
  component: string;
  description: string;
  maintainer: string;
  filename: string;
}

/** Groups the stanzas that belong in one `<component>/binary-<architecture>/Packages`. */
export interface AptIndexStanzas {
  component: string;
  architecture: string;
  stanzas: DebianStanza[];
}

const textEncoder = new TextEncoder();

/**
 * Control fields copied into a `Packages` stanza when the artifact carries
 * them, in the order Debian conventionally writes them.
 *
 * Dependency resolution is only as good as this list: without `Pre-Depends`
 * apt unpacks in the wrong order, without `Breaks` it will not displace a
 * conflicting package, and without `Multi-Arch` a foreign-architecture
 * dependency cannot be satisfied at all.
 */
const optionalDebianFields = [
  ["source", "Source"],
  ["installedSize", "Installed-Size"],
  ["multiArch", "Multi-Arch"],
  ["essential", "Essential"],
  ["preDepends", "Pre-Depends"],
  ["depends", "Depends"],
  ["recommends", "Recommends"],
  ["suggests", "Suggests"],
  ["enhances", "Enhances"],
  ["breaks", "Breaks"],
  ["conflicts", "Conflicts"],
  ["replaces", "Replaces"],
  ["provides", "Provides"],
  ["builtUsing", "Built-Using"],
  ["section", "Section"],
  ["priority", "Priority"],
  ["homepage", "Homepage"],
  ["origin", "Origin"],
  ["bugs", "Bugs"],
  ["tag", "Tag"],
] as const;

/** Maps a `.deb` control field name onto the artifact metadata key it feeds. */
export const debControlMetadataFields = [
  ["source", "source"],
  ["installed-size", "installedSize"],
  ["multi-arch", "multiArch"],
  ["essential", "essential"],
  ["pre-depends", "preDepends"],
  ["depends", "depends"],
  ["recommends", "recommends"],
  ["suggests", "suggests"],
  ["enhances", "enhances"],
  ["breaks", "breaks"],
  ["conflicts", "conflicts"],
  ["replaces", "replaces"],
  ["provides", "provides"],
  ["built-using", "builtUsing"],
  ["section", "section"],
  ["priority", "priority"],
  ["homepage", "homepage"],
  ["origin", "origin"],
  ["bugs", "bugs"],
  ["tag", "tag"],
] as const;

const safeDebFilenamePattern = /^[A-Za-z0-9][A-Za-z0-9._+~-]*\.u?deb$/;
// Rejecting control characters is the point: they would let a hostile deb
// control field inject extra stanza lines into a Packages index.
// eslint-disable-next-line no-control-regex
const controlCharacterPattern = /[\u0000-\u001F\u007F]/;

export function validateAptPublishArtifacts(input: {
  repository: Repository;
  artifacts: PublishArtifactRequest[];
}): void {
  parseAptRepositoryConfig(input.repository);
  for (const artifact of input.artifacts) {
    validateArtifactFilename(artifact.filename);
  }
}

export function validateAptArtifacts(input: {
  repository: Repository;
  artifacts: PublishArtifactRequest[];
}): ValidatedAptArtifact[] {
  const config = parseAptRepositoryConfig(input.repository);
  return input.artifacts.map((artifact) => {
    const metadata = artifact.metadata;
    const packageName = requiredArtifactString(metadata, "package");
    const version = requiredArtifactString(metadata, "version");
    const architecture = requiredArtifactString(metadata, "architecture");
    const component = optionalArtifactString(metadata, "component") ?? "main";
    const description = requiredArtifactString(metadata, "description");
    const maintainer = requiredArtifactString(metadata, "maintainer");
    const filename = validateArtifactFilename(artifact.filename);

    validateControlField(packageName, "artifact metadata package");
    validateControlField(version, "artifact metadata version");
    validateControlField(architecture, "artifact metadata architecture");
    validateControlField(component, "artifact metadata component");
    validateMultiLineControlField(description, "artifact metadata description");
    validateControlField(maintainer, "artifact metadata maintainer");
    validatePathSegment(packageName, "artifact metadata package");
    validatePathSegment(component, "artifact metadata component");
    if (architecture !== "all") {
      validatePathSegment(architecture, "artifact metadata architecture");
    }
    validateOptionalControlFields(metadata);

    if ((config.components ?? ["main"]).includes(component) === false) {
      throw new ValidationError("artifact metadata component is not configured for this repository");
    }
    if (architecture !== "all" && config.architectures && !config.architectures.includes(architecture)) {
      throw new ValidationError("artifact metadata architecture is not configured for this repository");
    }

    return {
      artifact,
      packageName,
      version,
      architecture,
      component,
      description,
      maintainer,
      filename,
    };
  });
}

export function buildPackageStanza(input: {
  metadata: Record<string, unknown>;
  packageName: string;
  version: string;
  architecture: string;
  maintainer: string;
  description: string;
  filename: string;
  size: number;
  sha256: string;
}): DebianStanza {
  const stanza: DebianStanza = [
    { name: "Package", value: input.packageName },
    { name: "Version", value: input.version },
    { name: "Architecture", value: input.architecture },
    { name: "Maintainer", value: input.maintainer },
  ];

  for (const [metadataField, debianField] of optionalDebianFields) {
    const value = input.metadata[metadataField];
    if (typeof value === "string" && value.length > 0) {
      stanza.push({ name: debianField, value });
    }
  }

  stanza.push(
    { name: "Filename", value: input.filename },
    { name: "Size", value: String(input.size) },
    { name: "SHA256", value: input.sha256 },
    { name: "Description", value: input.description },
  );

  return stanza;
}

/**
 * Recovers artifact metadata from a published stanza.
 *
 * Rebuilding the artifact list this way avoids re-reading and re-parsing every
 * `.deb` in the pool: the stanza already holds what was parsed out of it.
 */
export function packageStanzaMetadata(stanza: DebianStanza): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    package: stanzaField(stanza, "Package"),
    version: stanzaField(stanza, "Version"),
    architecture: stanzaField(stanza, "Architecture"),
    maintainer: stanzaField(stanza, "Maintainer"),
    description: stanzaField(stanza, "Description"),
  };

  for (const [metadataField, debianField] of optionalDebianFields) {
    metadata[metadataField] = stanzaField(stanza, debianField);
  }

  return metadata;
}

/**
 * Identifies the package a stanza describes within one index.
 *
 * Publishing the same package, version and architecture again replaces the
 * previous stanza rather than adding a duplicate.
 */
export function packageStanzaIdentity(stanza: DebianStanza): string {
  return [
    stanzaField(stanza, "Package") ?? "",
    stanzaField(stanza, "Version") ?? "",
    stanzaField(stanza, "Architecture") ?? "",
  ].join("\0");
}

export function indexKey(component: string, architecture: string): string {
  return `${component}\0${architecture}`;
}

/**
 * Settles which components and architectures the published indexes cover.
 *
 * When the repository does not pin `architectures`, the answer has to include
 * the architectures already on disk as well as the ones being published now.
 * Deriving it from the current publish alone would drop an architecture out of
 * `Release` the moment a publish happened not to contain one.
 */
export function resolveAptRepositoryConfig(input: {
  config: AptRepositoryConfig;
  existing: Map<string, AptIndexStanzas>;
  publishedArchitectures?: string[];
}): AptResolvedRepositoryConfig {
  const components = input.config.components ?? ["main"];
  if (input.config.architectures) {
    return { ...input.config, components, architectures: input.config.architectures };
  }

  const discovered = new Set<string>();
  for (const index of input.existing.values()) {
    discovered.add(index.architecture);
  }
  for (const architecture of input.publishedArchitectures ?? []) {
    if (architecture !== "all") {
      discovered.add(architecture);
    }
  }

  const architectures = [...discovered].sort((left, right) => left.localeCompare(right));
  return { ...input.config, components, architectures: architectures.length > 0 ? architectures : ["all"] };
}

/**
 * Merges freshly published stanzas over whatever each index already holds.
 *
 * A publish only ever describes the artifacts in that one session, so the
 * indexes have to be read back and merged: rebuilding them from the session
 * alone would silently drop every package published earlier.
 */
export function mergePackageStanzas(
  existing: Map<string, AptIndexStanzas>,
  incoming: Map<string, AptIndexStanzas>,
): Map<string, AptIndexStanzas> {
  const merged = new Map<string, AptIndexStanzas>();

  for (const [key, index] of existing) {
    merged.set(key, { ...index, stanzas: [...index.stanzas] });
  }

  for (const [key, index] of incoming) {
    const target = merged.get(key);
    if (!target) {
      merged.set(key, { ...index, stanzas: [...index.stanzas] });
      continue;
    }
    for (const stanza of index.stanzas) {
      const identity = packageStanzaIdentity(stanza);
      const replaced = target.stanzas.findIndex((candidate) => packageStanzaIdentity(candidate) === identity);
      if (replaced === -1) {
        target.stanzas.push(stanza);
      } else {
        target.stanzas[replaced] = stanza;
      }
    }
  }

  return merged;
}

export async function buildPackageIndexes(input: {
  repositoryName: string;
  codename: string;
  config: AptResolvedRepositoryConfig;
  stanzasByIndex: Map<string, AptIndexStanzas>;
}): Promise<AptPackageIndex[]> {
  const packageIndexes: AptPackageIndex[] = [];

  for (const component of input.config.components) {
    for (const architecture of input.config.architectures) {
      const index = input.stanzasByIndex.get(indexKey(component, architecture));
      if (index === undefined || index.stanzas.length === 0) {
        continue;
      }

      const relativePath = `${component}/binary-${architecture}/Packages`;
      const packagesPath = `repositories/${input.repositoryName}/dists/${input.codename}/${relativePath}`;
      const packages = [...index.stanzas]
        .sort((left, right) => comparePackageStanzas(left, right))
        .map((stanza) => formatStanza(stanza))
        .join("\n");
      const packagesGz = await gzip(textEncoder.encode(packages));

      packageIndexes.push({
        component,
        architecture,
        relativePath,
        relativeGzPath: `${relativePath}.gz`,
        packagesPath,
        packagesGzPath: `${packagesPath}.gz`,
        packages,
        packagesGz,
      });
    }
  }

  return packageIndexes;
}

export async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream !== "undefined") {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // Test and non-Worker runtimes may not expose CompressionStream. The
  // specifier is a constant; the indirection only stops bundlers pulling
  // node:zlib into the Worker build.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const dynamicImport = new Function("specifier", "return import(specifier)") as (
    specifier: string,
  ) => Promise<{ gzipSync(input: Uint8Array): Uint8Array }>;
  const { gzipSync } = await dynamicImport("node:zlib");
  return new Uint8Array(gzipSync(bytes));
}

function requiredArtifactString(metadata: Record<string, unknown>, field: string): string {
  const value = metadata[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new ValidationError(`artifact metadata ${field} is required`);
  }
  return value;
}

function optionalArtifactString(metadata: Record<string, unknown>, field: string): string | undefined {
  const value = metadata[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new ValidationError(`artifact metadata ${field} must be a non-empty string when provided`);
  }
  return value;
}

function validateArtifactFilename(filename: string): string {
  if (
    filename.length === 0 ||
    filename === "." ||
    filename === ".." ||
    filename.includes("/") ||
    filename.includes("\\") ||
    filename.includes("?") ||
    filename.includes("#") ||
    controlCharacterPattern.test(filename) ||
    !safeDebFilenamePattern.test(filename)
  ) {
    throw new ValidationError("artifact filename is not safe");
  }
  return filename;
}

function validateControlField(value: string, label: string): void {
  if (controlCharacterPattern.test(value)) {
    throw new ValidationError(`${label} must not contain control characters`);
  }
}

/**
 * Accepts the continuation lines a long description needs, and nothing else.
 *
 * Every line after the first must begin with a space, which is what keeps a
 * hostile description inside its own field instead of injecting a new one.
 */
function validateMultiLineControlField(value: string, label: string): void {
  const [first, ...continuations] = value.split("\n");
  validateControlField(first ?? "", label);
  for (const line of continuations) {
    if (!line.startsWith(" ")) {
      throw new ValidationError(`${label} continuation lines must start with a space`);
    }
    validateControlField(line, label);
  }
}

function validateOptionalControlFields(metadata: Record<string, unknown>): void {
  for (const [metadataField] of optionalDebianFields) {
    const value = metadata[metadataField];
    if (typeof value === "string" && value.length > 0) {
      validateControlField(value, `artifact metadata ${metadataField}`);
    }
  }
}

function comparePackageStanzas(left: DebianStanza, right: DebianStanza): number {
  return (
    compareStanzaField(left, right, "Package") ||
    compareStanzaField(left, right, "Version") ||
    compareStanzaField(left, right, "Architecture") ||
    compareStanzaField(left, right, "Filename")
  );
}

function compareStanzaField(left: DebianStanza, right: DebianStanza, field: string): number {
  return (stanzaField(left, field) ?? "").localeCompare(stanzaField(right, field) ?? "");
}
