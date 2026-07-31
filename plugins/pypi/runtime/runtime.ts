import type { RepositoryArtifactRecord, RepositoryObjectStore } from "@axis-repository/core";
import { ValidationError } from "@axis-repository/core";
import { pypiPluginManifest } from "../manifest";
import type {
  ArtifactRepositoryPlugin,
  DescribePublishedArtifactsInput,
  RebuildRepositoryArtifactIndexInput,
  ValidatePublishArtifactsInput,
} from "@axis-repository/runtime-cloudflare/plugin-runtime";
import {
  createPrefixServingPredicate,
  digestHex,
  digestStreamHex,
  listAllObjects,
  objectBytes,
  objectStream,
} from "@axis-repository/runtime-cloudflare/plugin-runtime";
import { createPypiAdminResources } from "./admin-resources";
import { createPypiClientHelpers } from "./client-helpers";
import { validatePypiRepositoryConfig } from "./config";
import { readDistributionMetadata } from "./distribution-source";
import {
  CORE_METADATA_CONTENT_TYPE,
  PACKAGES_PREFIX,
  SERVED_PREFIXES,
  SIMPLE_PREFIX,
  coreMetadataKey,
  packageRelativePath,
  parsePackageRelativePath,
  resolveSimplePath,
} from "./layout";
import { readPublishedProjectFiles, writeSimpleIndexes } from "./index-store";
import { parseCoreMetadata, type PypiCoreMetadata } from "../shared/metadata";
import {
  parseDistributionFilename,
  requireDistributionFilename,
  type PypiDistributionFilename,
} from "../shared/names";
import type { SimpleProjectFile } from "./simple-index";
import { inValidationErrorsSync } from "./format";
import { PypiPublisher } from "./publisher";
import { createPypiUploadProtocol } from "./upload-protocol";

export function createPypiPlugin(input?: {
  objectStoreFor?: (repositoryName: string) => RepositoryObjectStore;
}): ArtifactRepositoryPlugin {
  // Without a store there is nowhere to write. Fail loudly rather than
  // reporting a successful publish that stored nothing.
  const publisher = input?.objectStoreFor
    ? new PypiPublisher({ objectStoreFor: input.objectStoreFor })
    : {
      publish: async (): Promise<never> => {
        throw new ValidationError("PyPI repository plugin was created without an object store");
      },
    };
  return {
    ecosystem: "pypi",
    name: pypiPluginManifest.runtimeName,
    version: pypiPluginManifest.version,
    capabilities: [...pypiPluginManifest.capabilities],
    canServeRepositoryPath: createPrefixServingPredicate(SERVED_PREFIXES),
    uploadProtocol: createPypiUploadProtocol(),
    resolveRepositoryPath: ({ relativePath, accept }) => resolveSimplePath(relativePath, accept),
    validateRepositoryConfig: ({ config }) => validatePypiRepositoryConfig(config),
    publish: {
      validateArtifacts: validatePypiArtifacts,
      authorize: () => {},
      finalize: (publishInput) => publisher.publish(publishInput),
      describeArtifacts: describePypiArtifacts,
    },
    artifacts: {
      rebuildIndex: rebuildPypiArtifactIndex,
    },
    clientHelpers: createPypiClientHelpers(),
    ...(input?.objectStoreFor
      ? { adminResources: createPypiAdminResources({ objectStoreFor: input.objectStoreFor }) }
      : {}),
  };
}

/**
 * Rejects anything that is not a distribution pip could install.
 *
 * The filename is what decides which project page a file is listed on, so a
 * name that cannot be parsed has no page to go on, and one that normalizes to
 * an unusable path segment would produce a page nothing can address.
 */
function validatePypiArtifacts(input: ValidatePublishArtifactsInput): void {
  inValidationErrorsSync(() => {
    for (const artifact of input.artifacts) {
      requireDistributionFilename(artifact.filename);
    }
  });
}

function artifactRecord(input: {
  repositoryName: string;
  ecosystem: string;
  filename: string;
  normalizedName: string;
  version: string;
  objectKey: string;
  publishedAt: string;
  updatedAt: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}): RepositoryArtifactRecord {
  return {
    // Identity is the stored path, so the same file described by a publish and
    // by a rebuild is one artifact rather than two.
    id: `artifact_${input.repositoryName}_pypi_${input.normalizedName}_${input.filename}`,
    repositoryName: input.repositoryName,
    ecosystem: input.ecosystem,
    identity: `pypi:${input.normalizedName}:${input.filename}`,
    // The project, not the file: a wheel and a source distribution of one
    // release are the same thing, and so are two releases of it.
    family: `pypi:${input.normalizedName}`,
    name: input.normalizedName,
    summary: `${input.normalizedName} ${input.version}`,
    primaryObjectKey: input.objectKey,
    // The core metadata published beside the distribution belongs to it, and
    // is listed here so that deleting the artifact takes it too. A file with
    // no artifact left to belong to would be served forever with nothing
    // pointing at it and nothing to clean it up.
    objectKeys: [input.objectKey, coreMetadataKey(input.objectKey)],
    metadata: {
      ...input.metadata,
      project: input.normalizedName,
      version: input.version,
      filename: input.filename,
    },
    publishedAt: input.publishedAt,
    updatedAt: input.updatedAt,
    ...(input.sessionId ? { publishSessionId: input.sessionId } : {}),
  };
}

function describePypiArtifacts(input: DescribePublishedArtifactsInput): RepositoryArtifactRecord[] {
  return input.session.artifacts.flatMap((artifact) => {
    const distribution = parseDistributionFilename(artifact.filename);
    if (!distribution) {
      return [];
    }
    const relativePath = packageRelativePath(distribution, artifact.filename);
    const objectKey = input.result.objects
      .map((object) => object.key)
      .find((key) => key.endsWith(`/${relativePath}`));
    if (!objectKey) {
      return [];
    }
    return [artifactRecord({
      repositoryName: input.repository.name,
      ecosystem: input.repository.ecosystem,
      filename: artifact.filename,
      normalizedName: distribution.normalizedName,
      version: distribution.version,
      objectKey,
      publishedAt: input.result.publishedAt,
      updatedAt: input.result.publishedAt,
      sessionId: input.session.id,
      metadata: { ...artifact.metadata },
    })];
  });
}

/**
 * Rebuilds the artifact index and the Simple index from the files held.
 *
 * The stored distributions are the repository's own record of itself, so a
 * rebuild reads those rather than any bookkeeping written alongside them: a
 * repository whose bookkeeping is lost or wrong can still be repaired.
 *
 * The Simple index is rewritten as part of that, because it is bookkeeping
 * too. This runs after an artifact is deleted, and a page that still lists a
 * file nobody can fetch is worse than no page: pip resolves against it and
 * fails on the download rather than choosing another release.
 *
 * A yank is the one thing not derivable from the files — nothing in a
 * distribution records it — so it is carried over from the page being
 * replaced. A rebuild repairs the index; it does not un-yank a release.
 */
async function rebuildPypiArtifactIndex(
  input: RebuildRepositoryArtifactIndexInput,
): Promise<RepositoryArtifactRecord[]> {
  const repositoryPrefix = `repositories/${input.repository.name}/`;
  const objects = await listAllObjects(input.objectStore, `${repositoryPrefix}${PACKAGES_PREFIX}/`);
  const artifacts: RepositoryArtifactRecord[] = [];
  const byProject = new Map<string, StoredDistribution[]>();

  for (const object of objects) {
    const stored = parsePackageRelativePath(object.key.slice(repositoryPrefix.length));
    if (!stored) {
      continue;
    }
    const distribution = parseDistributionFilename(stored.filename);
    // A file whose name does not parse cannot be listed on any project page,
    // so it is not something this repository publishes. The core metadata
    // stored beside each distribution lands here too, and is skipped the same
    // way: it belongs to a distribution rather than standing on its own.
    if (!distribution || distribution.normalizedName !== stored.normalizedName) {
      continue;
    }
    artifacts.push(artifactRecord({
      repositoryName: input.repository.name,
      ecosystem: input.repository.ecosystem,
      filename: stored.filename,
      normalizedName: distribution.normalizedName,
      version: distribution.version,
      objectKey: object.key,
      publishedAt: input.now.toISOString(),
      updatedAt: input.now.toISOString(),
    }));
    byProject.set(
      distribution.normalizedName,
      [
        ...(byProject.get(distribution.normalizedName) ?? []),
        { filename: stored.filename, objectKey: object.key, distribution },
      ],
    );
  }

  await writeSimpleIndexes({
    objectStore: input.objectStore,
    repositoryName: input.repository.name,
    projects: await Promise.all([...byProject].map(async ([project, stored]) => ({
      project,
      files: await rebuiltProjectFiles({
        objectStore: input.objectStore,
        repositoryName: input.repository.name,
        project,
        stored,
      }),
    }))),
  });
  await removeEmptyProjectPages({
    objectStore: input.objectStore,
    repositoryName: input.repository.name,
    projects: new Set(byProject.keys()),
  });

  return artifacts;
}

/** A distribution found in the packages tree, with what it took to find it. */
interface StoredDistribution {
  filename: string;
  objectKey: string;
  distribution: PypiDistributionFilename;
}

/** Re-derives a project's page entries from the distributions it still holds. */
async function rebuiltProjectFiles(input: {
  objectStore: RepositoryObjectStore;
  repositoryName: string;
  project: string;
  stored: StoredDistribution[];
}): Promise<SimpleProjectFile[]> {
  const published = new Map(
    (await readPublishedProjectFiles({
      objectStore: input.objectStore,
      repositoryName: input.repositoryName,
      project: input.project,
    })).map((file) => [file.filename, file] as const),
  );

  return Promise.all(input.stored.map(async (stored) => {
    const previous = published.get(stored.filename);
    const metadata = await readOrRestoreCoreMetadata({
      objectStore: input.objectStore,
      key: stored.objectKey,
      distribution: stored.distribution,
    });
    return {
      filename: stored.filename,
      sha256: await digestObject(input.objectStore, stored.objectKey),
      ...(metadata.requiresPython ? { requiresPython: metadata.requiresPython } : {}),
      coreMetadataSha256: await digestHex("SHA-256", new TextEncoder().encode(metadata.text)),
      // Not something a distribution records, so it survives only by being
      // carried across.
      ...(previous?.yanked === undefined ? {} : { yanked: previous.yanked }),
    } satisfies SimpleProjectFile;
  }));
}

/**
 * Reads the core metadata beside a distribution, republishing it if it is gone.
 *
 * The side file is what PEP 658 serves and what the page's digest describes,
 * so a rebuild that found it missing and carried on would leave the page
 * pointing at nothing. It is cheap to read back out of the distribution.
 */
async function readOrRestoreCoreMetadata(input: {
  objectStore: RepositoryObjectStore;
  key: string;
  distribution: PypiDistributionFilename;
}): Promise<PypiCoreMetadata> {
  const stored = await input.objectStore.getObject(coreMetadataKey(input.key));
  if (stored) {
    return parseCoreMetadata(new TextDecoder().decode(await objectBytes(stored)));
  }

  const metadata = await readDistributionMetadata(input);
  await input.objectStore.putText(
    coreMetadataKey(input.key),
    metadata.text,
    CORE_METADATA_CONTENT_TYPE,
  );
  return metadata;
}

async function digestObject(
  objectStore: RepositoryObjectStore,
  key: string,
): Promise<string> {
  const object = await objectStore.getObject(key);
  if (!object) {
    throw new ValidationError(`PyPI distribution disappeared while being read: ${key}`);
  }
  return digestStreamHex("SHA-256", objectStream(object));
}

/**
 * Drops the pages of projects whose last distribution is gone.
 *
 * The root index is generated from the packages tree and stops listing them on
 * its own, but pip is given a project URL and asks for it directly, so a page
 * left behind stays reachable and keeps offering files that are not there.
 */
async function removeEmptyProjectPages(input: {
  objectStore: RepositoryObjectStore;
  repositoryName: string;
  projects: Set<string>;
}): Promise<void> {
  const prefix = `repositories/${input.repositoryName}/${SIMPLE_PREFIX}/`;
  const objects = await listAllObjects(input.objectStore, prefix);

  for (const object of objects) {
    const [project, ...rest] = object.key.slice(prefix.length).split("/");
    // The root index lives directly under the prefix and is not a project.
    if (rest.length === 0 || !project || input.projects.has(project)) {
      continue;
    }
    await input.objectStore.deleteObject(object.key);
  }
}
