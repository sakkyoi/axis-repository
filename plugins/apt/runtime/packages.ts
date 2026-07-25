import {
  ValidationError,
  type PublishArtifactRequest,
  type Repository,
} from "@axis-repository/core";
import { parseAptRepositoryConfig, validatePathSegment, type AptResolvedRepositoryConfig, type AptRepositoryConfig } from "./config";

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

const textEncoder = new TextEncoder();
const optionalDebianFields = [
  ["section", "Section"],
  ["priority", "Priority"],
  ["homepage", "Homepage"],
  ["depends", "Depends"],
  ["recommends", "Recommends"],
  ["suggests", "Suggests"],
  ["conflicts", "Conflicts"],
  ["replaces", "Replaces"],
  ["provides", "Provides"],
] as const;
const safeDebFilenamePattern = /^[A-Za-z0-9][A-Za-z0-9._+~-]*\.deb$/;
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
    validateControlField(description, "artifact metadata description");
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
}): string {
  const lines = [
    `Package: ${input.packageName}`,
    `Version: ${input.version}`,
    `Architecture: ${input.architecture}`,
    `Maintainer: ${input.maintainer}`,
  ];

  for (const [metadataField, debianField] of optionalDebianFields) {
    const value = input.metadata[metadataField];
    if (typeof value === "string" && value.length > 0) {
      lines.push(`${debianField}: ${value}`);
    }
  }

  lines.push(
    `Filename: ${input.filename}`,
    `Size: ${input.size}`,
    `SHA256: ${input.sha256}`,
    `Description: ${input.description}`,
  );

  return `${lines.join("\n")}\n`;
}

export async function buildPackageIndexes(input: {
  repositoryName: string;
  codename: string;
  config: AptResolvedRepositoryConfig;
  stanzasByIndex: Map<string, { component: string; architecture: string; stanzas: string[] }>;
}): Promise<AptPackageIndex[]> {
  const packageIndexes: AptPackageIndex[] = [];

  for (const component of input.config.components) {
    for (const architecture of input.config.architectures) {
      const index = input.stanzasByIndex.get(`${component}\0${architecture}`);
      if (index === undefined) {
        continue;
      }

      const relativePath = `${component}/binary-${architecture}/Packages`;
      const packagesPath = `repositories/${input.repositoryName}/dists/${input.codename}/${relativePath}`;
      const packages = [...index.stanzas].sort((left, right) => comparePackageStanzas(left, right)).join("\n");
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

  // Test and non-Worker runtimes may not expose CompressionStream.
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

function validateOptionalControlFields(metadata: Record<string, unknown>): void {
  for (const [metadataField] of optionalDebianFields) {
    const value = metadata[metadataField];
    if (typeof value === "string" && value.length > 0) {
      validateControlField(value, `artifact metadata ${metadataField}`);
    }
  }
}

function comparePackageStanzas(left: string, right: string): number {
  const leftSort = packageStanzaSortKey(left);
  const rightSort = packageStanzaSortKey(right);

  return (
    leftSort.packageName.localeCompare(rightSort.packageName) ||
    leftSort.version.localeCompare(rightSort.version) ||
    leftSort.architecture.localeCompare(rightSort.architecture) ||
    leftSort.filename.localeCompare(rightSort.filename)
  );
}

function packageStanzaSortKey(stanza: string): {
  packageName: string;
  version: string;
  architecture: string;
  filename: string;
} {
  return {
    packageName: readStanzaField(stanza, "Package"),
    version: readStanzaField(stanza, "Version"),
    architecture: readStanzaField(stanza, "Architecture"),
    filename: readStanzaField(stanza, "Filename"),
  };
}

function readStanzaField(stanza: string, field: string): string {
  const prefix = `${field}: `;
  return stanza
    .split("\n")
    .find((line) => line.startsWith(prefix))
    ?.slice(prefix.length) ?? "";
}
