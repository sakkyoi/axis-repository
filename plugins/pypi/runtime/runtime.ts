import type { RepositoryArtifactRecord, RepositoryObjectStore } from "@axis-repository/core";
import { ValidationError } from "@axis-repository/core";
import { pypiPluginManifest } from "../manifest";
import type {
  ArtifactRepositoryPlugin,
  DescribePublishedArtifactsInput,
  RebuildRepositoryArtifactIndexInput,
  ValidatePublishArtifactsInput,
} from "@axis-repository/runtime-cloudflare/plugin-runtime";
import { createPrefixServingPredicate, listAllObjects } from "@axis-repository/runtime-cloudflare/plugin-runtime";
import { createPypiAdminResources } from "./admin-resources";
import { createPypiClientHelpers } from "./client-helpers";
import { validatePypiRepositoryConfig } from "./config";
import { SERVED_PREFIXES, packageRelativePath, parsePackageRelativePath, resolveSimplePath } from "./layout";
import { parseDistributionFilename, requireDistributionFilename } from "./names";
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
  for (const artifact of input.artifacts) {
    requireDistributionFilename(artifact.filename);
  }
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
    name: input.normalizedName,
    summary: `${input.normalizedName} ${input.version}`,
    primaryObjectKey: input.objectKey,
    objectKeys: [input.objectKey],
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
 * Rebuilds the artifact index from the files the repository actually holds.
 *
 * The stored distributions are the repository's own record of itself, so a
 * rebuild reads those rather than any bookkeeping written alongside them: a
 * repository whose bookkeeping is lost or wrong can still be repaired.
 */
async function rebuildPypiArtifactIndex(
  input: RebuildRepositoryArtifactIndexInput,
): Promise<RepositoryArtifactRecord[]> {
  const repositoryPrefix = `repositories/${input.repository.name}/`;
  const objects = await listAllObjects(input.objectStore, `${repositoryPrefix}packages/`);
  const artifacts: RepositoryArtifactRecord[] = [];

  for (const object of objects) {
    const stored = parsePackageRelativePath(object.key.slice(repositoryPrefix.length));
    if (!stored) {
      continue;
    }
    const distribution = parseDistributionFilename(stored.filename);
    // A file whose name does not parse cannot be listed on any project page,
    // so it is not something this repository publishes.
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
  }

  return artifacts;
}
