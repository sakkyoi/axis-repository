import {
  ValidationError,
  type PublishArtifactsInput,
} from "@axis-repository/core";
import type { DebianStanza } from "../shared/stanza";
import { parseAptRepositoryConfig, validatePathSegment, type AptResolvedRepositoryConfig } from "./config";
import {
  contentsNameForStanza,
  mergeContentsIndex,
  type AptContentsIndex,
  type AptContentsIndexes,
} from "./contents";
import { buildAptIndexFiles, type AptIndexFile } from "./index-files";
import { buildSourceStanza, mergeSourceStanzas, parseDsc } from "./sources";
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
  type ValidatedAptEntry,
  type ValidatedAptSourceArtifact,
} from "./packages";
import { buildRelease } from "./release";

export type { AptRepositoryConfig } from "./config";
export type { AptContentsIndex, AptContentsIndexes } from "./contents";
export type { AptIndexFile } from "./index-files";
export type { AptIndexStanzas, AptPackageIndex, AptPoolCopy, AptSuiteIndexes } from "./packages";
export { parseAptRepositoryConfig, validateAptPublishArtifacts, gzip };

/** The indexes and signed-over `Release` that make up one published suite. */
export interface AptIndexMetadata {
  config: AptResolvedRepositoryConfig;
  suite: string;
  stanzasByIndex: AptSuiteIndexes;
  contentsByIndex: AptContentsIndexes;
  /** Source package stanzas per component, for `<component>/source/Sources`. */
  sourcesByComponent: Map<string, DebianStanza[]>;
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
  input: PublishArtifactsInput & {
    existingIndexes?: Map<string, AptSuiteIndexes>;
    existingContents?: Map<string, AptContentsIndexes>;
    existingSources?: Map<string, Map<string, DebianStanza[]>>;
    /** Repository-relative pool paths already stored, for source components. */
    poolFilenames?: Set<string>;
  },
): Promise<AptRepositoryMetadata> {
  const parsedConfig = parseAptRepositoryConfig(input.repository);
  const repositoryName = validatePathSegment(input.repository.name, "repository name");
  const existingIndexes = input.existingIndexes ?? new Map<string, AptSuiteIndexes>();
  const existingContents = input.existingContents ?? new Map<string, AptContentsIndexes>();
  const existingSources = input.existingSources ?? new Map<string, Map<string, DebianStanza[]>>();
  const incomingBySuite = new Map<string, AptSuiteIndexes>();
  const incomingContents = new Map<string, AptContentsIndexes>();
  const incomingSources = new Map<string, Map<string, DebianStanza[]>>();
  const poolCopies: AptPoolCopy[] = [];
  const validatedArtifacts = validateAptArtifacts({
    repository: input.repository,
    artifacts: input.artifacts.map((publishedArtifact) => publishedArtifact.artifact),
  });
  const config = resolveAptRepositoryConfig({
    config: parsedConfig,
    existing: existingIndexes.values(),
    publishedArchitectures: validatedArtifacts
      .filter((artifact) => !isSourceArtifact(artifact))
      .map((artifact) => artifact.architecture),
  });

  const sourceComponents = new Map<string, { validated: ValidatedAptSourceArtifact; verifiedSize: number }>();
  for (const [index, publishedArtifact] of input.artifacts.entries()) {
    const validated = validatedArtifacts[index];
    if (validated?.kind === "source-component") {
      sourceComponents.set(validated.filename, { validated, verifiedSize: publishedArtifact.verified.size });
      poolCopies.push({
        sourceKey: publishedArtifact.verified.objectKey,
        destinationKey: `repositories/${repositoryName}/${sourcePoolDirectory(validated)}/${validated.filename}`,
        contentType: validated.artifact.contentType,
      });
    }
  }

  for (const [index, publishedArtifact] of input.artifacts.entries()) {
    const validated = validatedArtifacts[index];
    if (!validated) {
      throw new ValidationError("APT artifact validation mismatch");
    }
    if (isSourceArtifact(validated)) {
      if (validated.kind === "source") {
        const source = await buildPublishedSourceStanza({
          repositoryName,
          validated,
          sourceComponents,
          poolFilenames: input.poolFilenames ?? new Set(),
        });
        poolCopies.push({
          sourceKey: publishedArtifact.verified.objectKey,
          destinationKey: `repositories/${repositoryName}/${source.directory}/${validated.filename}`,
          contentType: validated.artifact.contentType,
        });
        const bySuite = incomingSources.get(validated.suite) ?? new Map<string, DebianStanza[]>();
        incomingSources.set(validated.suite, bySuite);
        bySuite.set(validated.component, [...(bySuite.get(validated.component) ?? []), source.stanza]);
      }
      continue;
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
    const contents = incomingContents.get(validated.suite) ?? new Map<string, AptContentsIndex>();
    incomingContents.set(validated.suite, contents);
    const contentsName = contentsNameForStanza(packageStanza, validated.component);
    const targetArchitectures = validated.architecture === "all" ? config.architectures : [validated.architecture];
    for (const targetArchitecture of targetArchitectures) {
      addStanza(incoming, validated.component, targetArchitecture, validated.kind === "installer", packageStanza);
      if (contentsName !== undefined && validated.filePaths.length > 0) {
        const key = indexKey(validated.component, targetArchitecture, validated.kind === "installer");
        const index = contents.get(key) ?? new Map<string, string[]>();
        index.set(contentsName, [...validated.filePaths]);
        contents.set(key, index);
      }
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
    existingContents: existingContents.get(suite),
    incomingContents: incomingContents.get(suite),
    existingSources: existingSources.get(suite),
    incomingSources: incomingSources.get(suite),
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
  existingContents?: AptContentsIndexes | undefined;
  incomingContents?: AptContentsIndexes | undefined;
  existingSources?: Map<string, DebianStanza[]> | undefined;
  incomingSources?: Map<string, DebianStanza[]> | undefined;
  publishDate: string;
}): Promise<AptIndexMetadata> {
  const packageIndexes = buildPackageIndexes({
    config: input.config,
    stanzasByIndex: input.stanzasByIndex,
  });
  const contentsByIndex = resolveContents({
    packageIndexes,
    existing: input.existingContents,
    incoming: input.incomingContents,
  });
  const sourcesByComponent = new Map<string, DebianStanza[]>();
  for (const component of input.config.components) {
    const merged = mergeSourceStanzas(
      input.existingSources?.get(component) ?? [],
      input.incomingSources?.get(component) ?? [],
    );
    if (merged.length > 0) {
      sourcesByComponent.set(component, merged);
    }
  }
  const indexFiles = await buildAptIndexFiles({
    config: input.config,
    packageIndexes,
    contentsByIndex,
    sourcesByComponent,
  });

  return {
    config: input.config,
    suite: input.suite,
    stanzasByIndex: input.stanzasByIndex,
    contentsByIndex,
    sourcesByComponent,
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

/**
 * Settles the `Contents` of each index against the packages it publishes.
 *
 * Entries survive for packages this publish did not touch, so their `.deb`
 * files never have to be re-read, and disappear for packages the index no
 * longer lists.
 */
function resolveContents(input: {
  packageIndexes: AptPackageIndex[];
  existing?: AptContentsIndexes | undefined;
  incoming?: AptContentsIndexes | undefined;
}): AptContentsIndexes {
  const contentsByIndex: AptContentsIndexes = new Map();

  for (const packageIndex of input.packageIndexes) {
    const key = indexKey(packageIndex.component, packageIndex.architecture);
    const keepNames = new Set<string>();
    for (const stanza of packageIndex.stanzas) {
      const name = contentsNameForStanza(stanza, packageIndex.component);
      if (name !== undefined) {
        keepNames.add(name);
      }
    }

    const merged = mergeContentsIndex({
      existing: input.existing?.get(key),
      incoming: input.incoming?.get(key) ?? new Map<string, string[]>(),
      keepNames,
    });
    if (merged.size > 0) {
      contentsByIndex.set(key, merged);
    }
  }

  return contentsByIndex;
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
  installer: boolean,
  stanza: DebianStanza,
): void {
  const key = indexKey(component, architecture, installer);
  const index = indexes.get(key)
    ?? { component, architecture, ...(installer ? { installer } : {}), stanzas: [] };
  index.stanzas.push(stanza);
  indexes.set(key, index);
}

function isSourceArtifact(entry: ValidatedAptEntry): entry is ValidatedAptSourceArtifact {
  return entry.kind === "source" || entry.kind === "source-component";
}

function sourcePoolDirectory(validated: ValidatedAptSourceArtifact): string {
  const sourceName = sourceNameForComponentFile(validated.filename);
  return `pool/${validated.component}/${validatePathSegment(sourceName, "source package name")}`;
}

/**
 * Recovers the source package name from a component filename.
 *
 * Every file of a source package is named `<source>_<version>...`, so the part
 * before the first underscore is what puts them all in one pool directory.
 */
function sourceNameForComponentFile(filename: string): string {
  return filename.split("_")[0] ?? filename;
}

/**
 * Turns an uploaded `.dsc` into the stanza its `Sources` index publishes.
 *
 * Every file the `.dsc` names has to be reachable, either uploaded in this
 * session or already in the pool from an earlier one — re-uploading an
 * unchanged `.orig.tar` on every revision is the common Debian workflow, and
 * requiring it would break that. A `.dsc` whose tarballs are missing would
 * publish a source package apt cannot fetch.
 */
async function buildPublishedSourceStanza(input: {
  repositoryName: string;
  validated: ValidatedAptSourceArtifact;
  sourceComponents: Map<string, { validated: ValidatedAptSourceArtifact; verifiedSize: number }>;
  poolFilenames: Set<string>;
}): Promise<{ stanza: DebianStanza; directory: string }> {
  const { validated } = input;
  if (validated.dscText === undefined) {
    throw new ValidationError("APT source .dsc could not be read");
  }

  const dscBytes = new TextEncoder().encode(validated.dscText);
  const dsc = parseDsc(dscBytes);
  const directory = `pool/${validated.component}/${validatePathSegment(dsc.sourceName, "source package name")}`;

  for (const file of dsc.files) {
    validateSourceComponentName(file.name);
    const uploaded = input.sourceComponents.get(file.name);
    if (uploaded) {
      if (uploaded.validated.component !== validated.component || uploaded.validated.suite !== validated.suite) {
        throw new ValidationError(`APT source file is published to a different component or suite: ${file.name}`);
      }
      // A size that disagrees with the .dsc means the uploaded tarball is not
      // the one it describes, and apt would reject the mismatch anyway.
      if (Number.isFinite(file.size) && uploaded.verifiedSize !== file.size) {
        throw new ValidationError(`APT source file does not match the size its .dsc declares: ${file.name}`);
      }
      continue;
    }
    if (!input.poolFilenames.has(`${directory}/${file.name}`)) {
      throw new ValidationError(`APT source .dsc references a file that was not uploaded: ${file.name}`);
    }
  }

  return {
    directory,
    stanza: await buildSourceStanza({
      dsc,
      dscFile: { name: validated.filename, size: dscBytes.byteLength, bytes: dscBytes },
      component: validated.component,
      directory,
    }),
  };
}

function validateSourceComponentName(name: string): void {
  if (name.includes("/") || name.includes("\\") || name === "." || name === ".." || !/^[A-Za-z0-9][A-Za-z0-9._+~-]*$/.test(name)) {
    throw new ValidationError(`APT source .dsc names an unsafe file: ${name}`);
  }
}
