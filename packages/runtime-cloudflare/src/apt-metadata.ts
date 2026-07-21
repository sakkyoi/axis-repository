import {
  ValidationError,
  type PublishArtifactRequest,
  type PublishArtifactsInput,
  type Repository,
} from "@axis-repository/core";

export interface AptRepositoryConfig {
  codename: string;
  components: string[];
  architectures: string[];
  signingKeyId: string;
}

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

export interface AptRepositoryMetadata {
  config: AptRepositoryConfig;
  poolCopies: AptPoolCopy[];
  packageIndexes: AptPackageIndex[];
  packagesPath: string;
  packagesGzPath: string;
  releasePath: string;
  packages: string;
  packagesGz: Uint8Array;
  release: string;
}

interface ValidatedAptArtifact {
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
const safePathSegmentPattern = /^[A-Za-z0-9][A-Za-z0-9._+~-]*$/;
const safeDebFilenamePattern = /^[A-Za-z0-9][A-Za-z0-9._+~-]*\.deb$/;
const controlCharacterPattern = /[\u0000-\u001F\u007F]/;

export function parseAptRepositoryConfig(repository: Repository): AptRepositoryConfig {
  const aptConfig = readRecord(repository.config.apt);
  const codename = requiredConfigString(aptConfig, "codename");
  const components = requiredConfigStringArray(aptConfig, "components");
  const architectures = requiredConfigStringArray(aptConfig, "architectures");

  return {
    codename: validatePathSegment(codename, "config.apt.codename"),
    components: components.map((component) => validatePathSegment(component, "config.apt.components")),
    architectures: architectures.map((architecture) => validatePathSegment(architecture, "config.apt.architectures")),
    signingKeyId: requiredConfigString(aptConfig, "signingKeyId"),
  };
}

export function validateAptPublishArtifacts(input: {
  repository: Repository;
  artifacts: PublishArtifactRequest[];
}): void {
  validateAptArtifacts(input);
}

export async function buildAptRepositoryMetadata(input: PublishArtifactsInput): Promise<AptRepositoryMetadata> {
  const config = parseAptRepositoryConfig(input.repository);
  const repositoryName = validatePathSegment(input.repository.name, "repository name");
  const releasePath = `repositories/${repositoryName}/dists/${config.codename}/Release`;
  const stanzasByIndex = new Map<string, { component: string; architecture: string; stanzas: string[] }>();
  const poolCopies: AptPoolCopy[] = [];
  const validatedArtifacts = validateAptArtifacts({
    repository: input.repository,
    artifacts: input.artifacts.map((publishedArtifact) => publishedArtifact.artifact),
  });

  for (const [index, publishedArtifact] of input.artifacts.entries()) {
    const validated = validatedArtifacts[index];
    if (!validated) {
      throw new ValidationError("APT artifact validation mismatch");
    }
    const metadata = validated.artifact.metadata;

    const relativeFilename = `pool/${validated.component}/${validated.packageName}/${validated.filename}`;
    const packageStanza = buildPackageStanza({
      metadata,
      packageName: validated.packageName,
      version: validated.version,
      architecture: validated.architecture,
      maintainer: validated.maintainer,
      description: validated.description,
      filename: relativeFilename,
      size: publishedArtifact.verified.size,
      sha256: publishedArtifact.verified.sha256,
    });

    poolCopies.push({
      sourceKey: publishedArtifact.verified.objectKey,
      destinationKey: `repositories/${repositoryName}/${relativeFilename}`,
      contentType: validated.artifact.contentType,
    });

    const targetArchitectures = validated.architecture === "all" ? config.architectures : [validated.architecture];
    for (const targetArchitecture of targetArchitectures) {
      const indexKey = `${validated.component}\0${targetArchitecture}`;
      const index = stanzasByIndex.get(indexKey) ?? {
        component: validated.component,
        architecture: targetArchitecture,
        stanzas: [],
      };
      index.stanzas.push(packageStanza);
      stanzasByIndex.set(indexKey, index);
    }
  }

  const packageIndexes = await buildPackageIndexes({
    repositoryName,
    codename: config.codename,
    config,
    stanzasByIndex,
  });
  const firstIndex = packageIndexes[0];
  const fallbackPackagesPath = `repositories/${repositoryName}/dists/${config.codename}/${config.components[0]}/binary-${config.architectures[0]}/Packages`;
  const release = await buildRelease({
    repositoryName,
    config,
    publishDate: input.session.publishStartedAt ?? input.session.finalizingStartedAt ?? input.session.createdAt,
    packageIndexes,
  });

  return {
    config,
    poolCopies,
    packageIndexes,
    packagesPath: firstIndex?.packagesPath ?? fallbackPackagesPath,
    packagesGzPath: firstIndex?.packagesGzPath ?? `${fallbackPackagesPath}.gz`,
    releasePath,
    packages: firstIndex?.packages ?? "",
    packagesGz: firstIndex?.packagesGz ?? await gzip(new Uint8Array()),
    release,
  };
}

function validateAptArtifacts(input: {
  repository: Repository;
  artifacts: PublishArtifactRequest[];
}): ValidatedAptArtifact[] {
  const config = parseAptRepositoryConfig(input.repository);
  return input.artifacts.map((artifact) => {
    const metadata = artifact.metadata;
    const packageName = requiredArtifactString(metadata, "package");
    const version = requiredArtifactString(metadata, "version");
    const architecture = requiredArtifactString(metadata, "architecture");
    const component = requiredArtifactString(metadata, "component");
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

    if (!config.components.includes(component)) {
      throw new ValidationError("artifact metadata component is not configured for this repository");
    }
    if (architecture !== "all" && !config.architectures.includes(architecture)) {
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

function readRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function requiredConfigString(config: Record<string, unknown>, field: string): string {
  const value = config[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new ValidationError(`config.apt.${field} is required`);
  }
  return value;
}

function requiredConfigStringArray(config: Record<string, unknown>, field: string): string[] {
  const value = config[field];
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new ValidationError(`config.apt.${field} must be a non-empty string array`);
  }
  return [...value];
}

function requiredArtifactString(metadata: Record<string, unknown>, field: string): string {
  const value = metadata[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new ValidationError(`artifact metadata ${field} is required`);
  }
  return value;
}

function buildPackageStanza(input: {
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

function validatePathSegment(value: string, label: string): string {
  if (!safePathSegmentPattern.test(value) || value === "." || value === "..") {
    throw new ValidationError(`${label} contains unsafe path characters`);
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

async function buildRelease(input: {
  repositoryName: string;
  config: AptRepositoryConfig;
  publishDate: string;
  packageIndexes: AptPackageIndex[];
}): Promise<string> {
  const sha256Lines: string[] = [];
  const sha512Lines: string[] = [];

  for (const packageIndex of input.packageIndexes) {
    const packagesBytes = textEncoder.encode(packageIndex.packages);
    const packagesSha256 = await digestHex("SHA-256", packagesBytes);
    const packagesGzSha256 = await digestHex("SHA-256", packageIndex.packagesGz);
    const packagesSha512 = await digestHex("SHA-512", packagesBytes);
    const packagesGzSha512 = await digestHex("SHA-512", packageIndex.packagesGz);

    sha256Lines.push(
      ` ${packagesSha256} ${packagesBytes.byteLength} ${packageIndex.relativePath}`,
      ` ${packagesGzSha256} ${packageIndex.packagesGz.byteLength} ${packageIndex.relativeGzPath}`,
    );
    sha512Lines.push(
      ` ${packagesSha512} ${packagesBytes.byteLength} ${packageIndex.relativePath}`,
      ` ${packagesGzSha512} ${packageIndex.packagesGz.byteLength} ${packageIndex.relativeGzPath}`,
    );
  }

  return [
    `Origin: ${input.repositoryName}`,
    `Label: ${input.repositoryName}`,
    `Suite: ${input.config.codename}`,
    `Codename: ${input.config.codename}`,
    `Date: ${new Date(input.publishDate).toUTCString()}`,
    `Architectures: ${input.config.architectures.join(" ")}`,
    `Components: ${input.config.components.join(" ")}`,
    "SHA256:",
    ...sha256Lines,
    "SHA512:",
    ...sha512Lines,
    "",
  ].join("\n");
}

async function buildPackageIndexes(input: {
  repositoryName: string;
  codename: string;
  config: AptRepositoryConfig;
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

async function digestHex(algorithm: "SHA-256" | "SHA-512", bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(algorithm, bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
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
