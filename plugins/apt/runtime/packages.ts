import {
  ValidationError,
  type PublishArtifactRequest,
  type Repository,
} from "@axis-repository/core";
import { md5Hex } from "../shared/md5";
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
  installer?: boolean;
  /** Path under `dists/<codename>/`, as `Release` lists it. */
  relativePath: string;
  packages: string;
  /** The stanzas as published, sorted, so translations can reuse them. */
  stanzas: DebianStanza[];
}

export interface ValidatedAptArtifact {
  kind: "binary" | "installer";
  artifact: PublishArtifactRequest;
  packageName: string;
  version: string;
  architecture: string;
  suite: string;
  component: string;
  description: string;
  maintainer: string;
  filename: string;
  /** Paths the package installs, read out of its data archive at publish. */
  filePaths: string[];
}

/** A `.dsc` or one of the tarballs it points at. */
export interface ValidatedAptSourceArtifact {
  kind: "source" | "source-component";
  artifact: PublishArtifactRequest;
  filename: string;
  component: string;
  suite: string;
  /** The `.dsc` text, present only on the source control file itself. */
  dscText?: string;
}

export type ValidatedAptEntry = ValidatedAptArtifact | ValidatedAptSourceArtifact;

/** Groups the stanzas that belong in one `<component>/binary-<architecture>/Packages`. */
export interface AptIndexStanzas {
  component: string;
  architecture: string;
  /** Installer packages live in their own index under `debian-installer/`. */
  installer?: boolean;
  stanzas: DebianStanza[];
}

/**
 * What an uploaded file is, decided by its name.
 *
 * A publish session can hold binary packages, installer packages, and the
 * `.dsc` and tarballs of a source package, and each ends up in a different
 * index — or, for the tarballs, in no index of its own at all.
 */
export type AptArtifactKind = "binary" | "installer" | "source" | "source-component";

export function aptArtifactKind(filename: string): AptArtifactKind | undefined {
  if (installerFilenamePattern.test(filename)) return "installer";
  if (binaryFilenamePattern.test(filename)) return "binary";
  if (sourceControlFilenamePattern.test(filename)) return "source";
  if (sourceComponentFilenamePattern.test(filename)) return "source-component";
  return undefined;
}

/** The published `Packages` indexes of one suite, keyed by component and architecture. */
export type AptSuiteIndexes = Map<string, AptIndexStanzas>;

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

const safeArtifactNamePattern = /^[A-Za-z0-9][A-Za-z0-9._+~-]*$/;
const binaryFilenamePattern = /\.deb$/;
const installerFilenamePattern = /\.udeb$/;
const sourceControlFilenamePattern = /\.dsc$/;
// The tarballs and diff a .dsc points at; dpkg has used all of these.
const sourceComponentFilenamePattern = /\.(tar\.(gz|xz|bz2|zst|lzma)|diff\.gz)$/;
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

export function indexRelativePath(index: { component: string; architecture: string; installer?: boolean }): string {
  return index.installer
    ? `${index.component}/debian-installer/binary-${index.architecture}/Packages`
    : `${index.component}/binary-${index.architecture}/Packages`;
}

export function validateAptArtifacts(input: {
  repository: Repository;
  artifacts: PublishArtifactRequest[];
}): ValidatedAptEntry[] {
  const config = parseAptRepositoryConfig(input.repository);
  return input.artifacts.map((artifact) => {
    const metadata = artifact.metadata;
    const filename = validateArtifactFilename(artifact.filename);
    const kind = aptArtifactKind(filename);
    const component = optionalArtifactString(metadata, "component") ?? "main";
    const suite = optionalArtifactString(metadata, "suite") ?? config.codename;
    validateControlField(component, "artifact metadata component");
    validatePathSegment(component, "artifact metadata component");
    validatePathSegment(suite, "artifact metadata suite");
    if ((config.components ?? ["main"]).includes(component) === false) {
      throw new ValidationError("artifact metadata component is not configured for this repository");
    }
    if ((config.suites ?? [config.codename]).includes(suite) === false) {
      throw new ValidationError("artifact metadata suite is not configured for this repository");
    }

    if (kind === "source" || kind === "source-component") {
      const dscText = metadata.dscText;
      return {
        kind,
        artifact,
        filename,
        component,
        suite,
        ...(typeof dscText === "string" ? { dscText } : {}),
      };
    }

    const packageName = requiredArtifactString(metadata, "package");
    const version = requiredArtifactString(metadata, "version");
    const architecture = requiredArtifactString(metadata, "architecture");
    const description = requiredArtifactString(metadata, "description");
    const maintainer = requiredArtifactString(metadata, "maintainer");

    validateControlField(packageName, "artifact metadata package");
    validateControlField(version, "artifact metadata version");
    validateControlField(architecture, "artifact metadata architecture");
    validateMultiLineControlField(description, "artifact metadata description");
    validateControlField(maintainer, "artifact metadata maintainer");
    validatePathSegment(packageName, "artifact metadata package");
    if (architecture !== "all") {
      validatePathSegment(architecture, "artifact metadata architecture");
    }
    validateOptionalControlFields(metadata);

    if (architecture !== "all" && config.architectures && !config.architectures.includes(architecture)) {
      throw new ValidationError("artifact metadata architecture is not configured for this repository");
    }

    return {
      kind: kind === "installer" ? "installer" : "binary",
      artifact,
      packageName,
      version,
      architecture,
      suite,
      component,
      description,
      maintainer,
      filename,
      filePaths: artifactFilePaths(metadata),
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

export function indexKey(component: string, architecture: string, installer = false): string {
  return `${component}\0${architecture}\0${installer ? "udeb" : "deb"}`;
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
  existing: Iterable<AptSuiteIndexes>;
  publishedArchitectures?: string[];
}): AptResolvedRepositoryConfig {
  const components = input.config.components ?? ["main"];
  const suites = input.config.suites ?? [input.config.codename];
  if (input.config.architectures) {
    return { ...input.config, suites, components, architectures: input.config.architectures };
  }

  const discovered = new Set<string>();
  for (const suiteIndexes of input.existing) {
    for (const index of suiteIndexes.values()) {
      discovered.add(index.architecture);
    }
  }
  for (const architecture of input.publishedArchitectures ?? []) {
    if (architecture !== "all") {
      discovered.add(architecture);
    }
  }

  const architectures = [...discovered].sort((left, right) => left.localeCompare(right));
  return {
    ...input.config,
    suites,
    components,
    architectures: architectures.length > 0 ? architectures : ["all"],
  };
}

/**
 * Merges freshly published stanzas over whatever each index already holds.
 *
 * A publish only ever describes the artifacts in that one session, so the
 * indexes have to be read back and merged: rebuilding them from the session
 * alone would silently drop every package published earlier.
 */
export function mergePackageStanzas(
  existing: AptSuiteIndexes,
  incoming: AptSuiteIndexes,
): AptSuiteIndexes {
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

export function buildPackageIndexes(input: {
  config: AptResolvedRepositoryConfig;
  stanzasByIndex: AptSuiteIndexes;
}): AptPackageIndex[] {
  const packageIndexes: AptPackageIndex[] = [];

  for (const component of input.config.components) {
    for (const architecture of input.config.architectures) {
      for (const installer of [false, true]) {
        const index = input.stanzasByIndex.get(indexKey(component, architecture, installer));
        if (index === undefined || index.stanzas.length === 0) {
          continue;
        }

        const stanzas = index.stanzas
          .map((stanza) => withDescriptionDigest(stanza))
          .sort((left, right) => comparePackageStanzas(left, right));

        packageIndexes.push({
          component,
          architecture,
          ...(installer ? { installer } : {}),
          relativePath: indexRelativePath({ component, architecture, installer }),
          packages: stanzas.map((stanza) => formatStanza(stanza)).join("\n"),
          stanzas,
        });
      }
    }
  }

  return packageIndexes;
}

/**
 * Adds `Description-md5` when a stanza lacks it.
 *
 * apt matches a package to its entry in a `Translation-*` index by this
 * digest. Deriving it here rather than only when a stanza is first built means
 * indexes published before translations existed pick it up on their next
 * write, without having to re-read every `.deb`.
 */
export function withDescriptionDigest(stanza: DebianStanza): DebianStanza {
  const description = stanzaField(stanza, "Description");
  if (description === undefined || stanzaField(stanza, "Description-md5") !== undefined) {
    return stanza;
  }
  return [...stanza, { name: "Description-md5", value: descriptionDigest(description) }];
}

/** Debian hashes the description with the newline that terminates the field. */
export function descriptionDigest(description: string): string {
  return md5Hex(`${description}\n`);
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

/**
 * Reads the installed file list the publisher attached.
 *
 * It rides on the artifact metadata rather than the stanza because `Contents`
 * is a separate index: no `Packages` field carries it.
 */
function artifactFilePaths(metadata: Record<string, unknown>): string[] {
  const value = metadata.filePaths;
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((path): path is string => typeof path === "string" && path.length > 0);
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
    !safeArtifactNamePattern.test(filename) ||
    aptArtifactKind(filename) === undefined
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
