import {
  ValidationError,
  type PublishArtifactsInput,
} from "@axis-repository/core";
import type { DebianStanza } from "../shared/stanza";
import { parseAptRepositoryConfig, validatePathSegment, type AptResolvedRepositoryConfig } from "./config";
import {
  buildPackageIndexes,
  buildPackageStanza,
  gzip,
  indexKey,
  mergePackageStanzas,
  resolveAptRepositoryConfig,
  validateAptArtifacts,
  validateAptPublishArtifacts,
  type AptIndexStanzas,
  type AptPackageIndex,
  type AptPoolCopy,
} from "./packages";
import { buildRelease } from "./release";

export type { AptRepositoryConfig } from "./config";
export type { AptIndexStanzas, AptPackageIndex, AptPoolCopy } from "./packages";
export { parseAptRepositoryConfig, validateAptPublishArtifacts, gzip };

/** The indexes and signed-over `Release` that make up one published suite. */
export interface AptIndexMetadata {
  config: AptResolvedRepositoryConfig;
  stanzasByIndex: Map<string, AptIndexStanzas>;
  packageIndexes: AptPackageIndex[];
  releasePath: string;
  release: string;
}

export interface AptRepositoryMetadata extends AptIndexMetadata {
  poolCopies: AptPoolCopy[];
}

/**
 * Builds the published state for a repository from the indexes it already has
 * plus the artifacts of one publish session.
 *
 * `existingIndexes` is what makes a publish additive. A session only describes
 * the artifacts uploaded to it, so building the indexes from the session alone
 * would drop every package published before it — the `.deb` files would stay
 * in the pool while disappearing from `Packages`.
 */
export async function buildAptRepositoryMetadata(
  input: PublishArtifactsInput & { existingIndexes?: Map<string, AptIndexStanzas> },
): Promise<AptRepositoryMetadata> {
  const parsedConfig = parseAptRepositoryConfig(input.repository);
  const repositoryName = validatePathSegment(input.repository.name, "repository name");
  const existingIndexes = input.existingIndexes ?? new Map<string, AptIndexStanzas>();
  const incoming = new Map<string, AptIndexStanzas>();
  const poolCopies: AptPoolCopy[] = [];
  const validatedArtifacts = validateAptArtifacts({
    repository: input.repository,
    artifacts: input.artifacts.map((publishedArtifact) => publishedArtifact.artifact),
  });
  const config = resolveAptRepositoryConfig({
    config: parsedConfig,
    existing: existingIndexes,
    publishedArchitectures: validatedArtifacts.map((artifact) => artifact.architecture),
  });

  for (const [index, publishedArtifact] of input.artifacts.entries()) {
    const validated = validatedArtifacts[index];
    if (!validated) {
      throw new ValidationError("APT artifact validation mismatch");
    }

    const relativeFilename = `pool/${validated.component}/${validated.packageName}/${validated.filename}`;
    const packageStanza = buildPackageStanza({
      metadata: validated.artifact.metadata,
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
      addStanza(incoming, validated.component, targetArchitecture, packageStanza);
    }
  }

  return {
    ...(await buildAptIndexMetadata({
      repositoryName,
      config,
      stanzasByIndex: mergePackageStanzas(existingIndexes, incoming),
      publishDate: input.session.publishStartedAt ?? input.session.finalizingStartedAt ?? input.session.createdAt,
    })),
    poolCopies,
  };
}

/** Builds indexes and `Release` from stanzas that are already settled. */
export async function buildAptIndexMetadata(input: {
  repositoryName: string;
  config: AptResolvedRepositoryConfig;
  stanzasByIndex: Map<string, AptIndexStanzas>;
  publishDate: string;
}): Promise<AptIndexMetadata> {
  const packageIndexes = await buildPackageIndexes({
    repositoryName: input.repositoryName,
    codename: input.config.codename,
    config: input.config,
    stanzasByIndex: input.stanzasByIndex,
  });

  return {
    config: input.config,
    stanzasByIndex: input.stanzasByIndex,
    packageIndexes,
    releasePath: `repositories/${input.repositoryName}/dists/${input.config.codename}/Release`,
    release: await buildRelease({
      repositoryName: input.repositoryName,
      config: input.config,
      publishDate: input.publishDate,
      packageIndexes,
    }),
  };
}

/** Drops every stanza whose `Filename` matches, across all indexes. */
export function removeStanzasByFilename(
  stanzasByIndex: Map<string, AptIndexStanzas>,
  relativeFilenames: Set<string>,
): Map<string, AptIndexStanzas> {
  const remaining = new Map<string, AptIndexStanzas>();

  for (const [key, index] of stanzasByIndex) {
    remaining.set(key, {
      ...index,
      stanzas: index.stanzas.filter((stanza) => {
        const filename = stanza.find((field) => field.name.toLowerCase() === "filename")?.value;
        return filename === undefined || !relativeFilenames.has(filename);
      }),
    });
  }

  return remaining;
}

function addStanza(
  indexes: Map<string, AptIndexStanzas>,
  component: string,
  architecture: string,
  stanza: DebianStanza,
): void {
  const key = indexKey(component, architecture);
  const index = indexes.get(key) ?? { component, architecture, stanzas: [] };
  index.stanzas.push(stanza);
  indexes.set(key, index);
}
