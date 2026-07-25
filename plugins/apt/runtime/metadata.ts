import {
  ValidationError,
  type PublishArtifactsInput,
} from "@axis-repository/core";
import { parseAptRepositoryConfig, validatePathSegment, type AptRepositoryConfig, type AptResolvedRepositoryConfig } from "./config";
import {
  buildPackageIndexes,
  buildPackageStanza,
  gzip,
  validateAptArtifacts,
  validateAptPublishArtifacts,
  type AptPackageIndex,
  type AptPoolCopy,
} from "./packages";
import { buildRelease } from "./release";

export type { AptRepositoryConfig } from "./config";
export type { AptPackageIndex, AptPoolCopy } from "./packages";
export { parseAptRepositoryConfig, validateAptPublishArtifacts };

export interface AptRepositoryMetadata {
  config: AptResolvedRepositoryConfig;
  poolCopies: AptPoolCopy[];
  packageIndexes: AptPackageIndex[];
  packagesPath: string;
  packagesGzPath: string;
  releasePath: string;
  packages: string;
  packagesGz: Uint8Array;
  release: string;
}

export async function buildAptRepositoryMetadata(input: PublishArtifactsInput): Promise<AptRepositoryMetadata> {
  const parsedConfig = parseAptRepositoryConfig(input.repository);
  const repositoryName = validatePathSegment(input.repository.name, "repository name");
  const releasePath = `repositories/${repositoryName}/dists/${parsedConfig.codename}/Release`;
  const stanzasByIndex = new Map<string, { component: string; architecture: string; stanzas: string[] }>();
  const poolCopies: AptPoolCopy[] = [];
  const validatedArtifacts = validateAptArtifacts({
    repository: input.repository,
    artifacts: input.artifacts.map((publishedArtifact) => publishedArtifact.artifact),
  });
  const config: AptResolvedRepositoryConfig = {
    ...parsedConfig,
    components: effectiveComponents(parsedConfig),
    architectures: effectiveArchitectures(parsedConfig, validatedArtifacts),
  };

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

function effectiveArchitectures(
  config: AptRepositoryConfig,
  artifacts: Array<{ architecture: string }>,
): string[] {
  if (config.architectures) {
    return config.architectures;
  }

  const concrete = uniqueSorted(artifacts
    .map((artifact) => artifact.architecture)
    .filter((architecture) => architecture !== "all"));
  return concrete.length > 0 ? concrete : ["all"];
}

function effectiveComponents(config: AptRepositoryConfig): string[] {
  return config.components ?? ["main"];
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
