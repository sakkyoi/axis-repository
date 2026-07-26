import {
  ValidationError,
  type PublishArtifactsInput,
} from "@axis-repository/core";
import type { DebianStanza } from "../shared/stanza";
import { parseAptRepositoryConfig, validatePathSegment, type AptResolvedRepositoryConfig } from "./config";
import { buildAptIndexFiles, type AptIndexFile } from "./index-files";
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
  type AptSuiteIndexes,
} from "./packages";
import { buildRelease } from "./release";

export type { AptRepositoryConfig } from "./config";
export type { AptIndexFile } from "./index-files";
export type { AptIndexStanzas, AptPackageIndex, AptPoolCopy, AptSuiteIndexes } from "./packages";
export { parseAptRepositoryConfig, validateAptPublishArtifacts, gzip };

/** The indexes and signed-over `Release` that make up one published suite. */
export interface AptIndexMetadata {
  config: AptResolvedRepositoryConfig;
  suite: string;
  stanzasByIndex: AptSuiteIndexes;
  packageIndexes: AptPackageIndex[];
  /** Everything written under `dists/<suite>/` and listed in `Release`. */
  indexFiles: AptIndexFile[];
  releasePath: string;
  release: string;
}

export interface AptRepositoryMetadata {
  config: AptResolvedRepositoryConfig;
  poolCopies: AptPoolCopy[];
  /** One entry per suite the repository publishes, whether or not it changed. */
  suites: AptIndexMetadata[];
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
  input: PublishArtifactsInput & { existingIndexes?: Map<string, AptSuiteIndexes> },
): Promise<AptRepositoryMetadata> {
  const parsedConfig = parseAptRepositoryConfig(input.repository);
  const repositoryName = validatePathSegment(input.repository.name, "repository name");
  const existingIndexes = input.existingIndexes ?? new Map<string, AptSuiteIndexes>();
  const incomingBySuite = new Map<string, AptSuiteIndexes>();
  const poolCopies: AptPoolCopy[] = [];
  const validatedArtifacts = validateAptArtifacts({
    repository: input.repository,
    artifacts: input.artifacts.map((publishedArtifact) => publishedArtifact.artifact),
  });
  const config = resolveAptRepositoryConfig({
    config: parsedConfig,
    existing: existingIndexes.values(),
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

    // The pool is shared across suites, so the same object key is written once
    // however many suites end up pointing at it.
    poolCopies.push({
      sourceKey: publishedArtifact.verified.objectKey,
      destinationKey: `repositories/${repositoryName}/${relativeFilename}`,
      contentType: validated.artifact.contentType,
    });

    const incoming = incomingBySuite.get(validated.suite) ?? new Map<string, AptIndexStanzas>();
    incomingBySuite.set(validated.suite, incoming);
    const targetArchitectures = validated.architecture === "all" ? config.architectures : [validated.architecture];
    for (const targetArchitecture of targetArchitectures) {
      addStanza(incoming, validated.component, targetArchitecture, packageStanza);
    }
  }

  const publishDate = input.session.publishStartedAt ?? input.session.finalizingStartedAt ?? input.session.createdAt;
  const suites = await Promise.all(config.suites.map((suite) => buildAptIndexMetadata({
    repositoryName,
    config,
    suite,
    stanzasByIndex: mergePackageStanzas(
      existingIndexes.get(suite) ?? new Map<string, AptIndexStanzas>(),
      incomingBySuite.get(suite) ?? new Map<string, AptIndexStanzas>(),
    ),
    publishDate,
  })));

  return { config, poolCopies, suites };
}

/** Builds indexes and `Release` from stanzas that are already settled. */
export async function buildAptIndexMetadata(input: {
  repositoryName: string;
  config: AptResolvedRepositoryConfig;
  suite: string;
  stanzasByIndex: AptSuiteIndexes;
  publishDate: string;
}): Promise<AptIndexMetadata> {
  const packageIndexes = buildPackageIndexes({
    config: input.config,
    stanzasByIndex: input.stanzasByIndex,
  });
  const indexFiles = await buildAptIndexFiles({ config: input.config, packageIndexes });

  return {
    config: input.config,
    suite: input.suite,
    stanzasByIndex: input.stanzasByIndex,
    packageIndexes,
    indexFiles,
    releasePath: `repositories/${input.repositoryName}/dists/${input.suite}/Release`,
    release: await buildRelease({
      repositoryName: input.repositoryName,
      config: input.config,
      suite: input.suite,
      publishDate: input.publishDate,
      indexFiles,
    }),
  };
}

/** Drops every stanza whose `Filename` matches, across all indexes. */
export function removeStanzasByFilename(
  stanzasByIndex: AptSuiteIndexes,
  relativeFilenames: Set<string>,
): AptSuiteIndexes {
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
  indexes: AptSuiteIndexes,
  component: string,
  architecture: string,
  stanza: DebianStanza,
): void {
  const key = indexKey(component, architecture);
  const index = indexes.get(key) ?? { component, architecture, stanzas: [] };
  index.stanzas.push(stanza);
  indexes.set(key, index);
}
