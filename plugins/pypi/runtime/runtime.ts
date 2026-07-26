import type { RepositoryArtifactRecord, RepositoryObjectStore } from "@axis-repository/core";
import { ValidationError } from "@axis-repository/core";
import { pypiPluginManifest } from "../manifest";
import type { ArtifactRepositoryPlugin, DescribePublishedArtifactsInput, RebuildRepositoryArtifactIndexInput } from "@axis-repository/runtime-cloudflare/plugin-runtime";
import { GenericManifestPublisher, createPrefixServingPredicate, listAllObjects, objectBytes } from "@axis-repository/runtime-cloudflare/plugin-runtime";
import { createPypiClientHelpers } from "./client-helpers";
import { validatePypiRepositoryConfig } from "./config";

export function createPypiPlugin(input?: {
  objectStoreFor?: (repositoryName: string) => RepositoryObjectStore;
}): ArtifactRepositoryPlugin {
  // Without a store there is nowhere to write. Fail loudly rather than
  // reporting a successful publish that stored nothing.
  const publisher = input?.objectStoreFor
    ? new GenericManifestPublisher({ objectStoreFor: input.objectStoreFor })
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
    canServeRepositoryPath: createPrefixServingPredicate(["simple"]),
    validateRepositoryConfig: ({ config }) => validatePypiRepositoryConfig(config),
    publish: {
      validateArtifacts: () => {},
      authorize: () => {},
      finalize: (publishInput) => publisher.publish(publishInput),
      describeArtifacts: describePypiArtifacts,
    },
    artifacts: {
      rebuildIndex: rebuildPypiArtifactIndex,
    },
    clientHelpers: createPypiClientHelpers(),
  };
}

function describePypiArtifacts(input: DescribePublishedArtifactsInput): RepositoryArtifactRecord[] {
  const objectKeys = input.result.objects.map((object) => object.key);
  return input.session.artifacts.map((artifact) => {
    const primaryObjectKey = objectKeys.find((key) => key.endsWith(`/${input.session.id}.json`));
    return {
      id: `artifact_${input.repository.name}_pypi_${artifact.filename}`,
      repositoryName: input.repository.name,
      ecosystem: input.repository.ecosystem,
      identity: `pypi:${artifact.filename}`,
      name: artifact.filename,
      summary: artifact.filename,
      ...(primaryObjectKey ? { primaryObjectKey } : {}),
      objectKeys,
      metadata: { ...artifact.metadata },
      publishedAt: input.result.publishedAt,
      updatedAt: input.result.publishedAt,
      publishSessionId: input.session.id,
    };
  });
}

async function rebuildPypiArtifactIndex(input: RebuildRepositoryArtifactIndexInput): Promise<RepositoryArtifactRecord[]> {
  const publishPrefix = `repositories/${input.repository.name}/publishes/`;
  const objects = await listAllObjects(input.objectStore, publishPrefix);
  const artifacts: RepositoryArtifactRecord[] = [];

  for (const object of objects.filter((candidate) => candidate.key.endsWith(".json"))) {
    const storedObject = await input.objectStore.getObject(object.key);
    if (!storedObject) continue;
    const manifest = JSON.parse(new TextDecoder().decode(await objectBytes(storedObject))) as {
      sessionId?: string;
      publishedAt?: string;
      artifacts?: Array<{ filename?: string; metadata?: Record<string, unknown>; objectKey?: string }>;
    };
    for (const artifact of manifest.artifacts ?? []) {
      if (!artifact.filename) continue;
      const objectKeys = [artifact.objectKey, object.key].filter((key): key is string => Boolean(key));
      artifacts.push({
        id: `artifact_${input.repository.name}_pypi_${artifact.filename}`,
        repositoryName: input.repository.name,
        ecosystem: input.repository.ecosystem,
        identity: `pypi:${artifact.filename}`,
        name: artifact.filename,
        summary: artifact.filename,
        primaryObjectKey: artifact.objectKey ?? object.key,
        objectKeys,
        metadata: artifact.metadata ?? {},
        publishedAt: manifest.publishedAt ?? input.now.toISOString(),
        updatedAt: input.now.toISOString(),
        ...(manifest.sessionId ? { publishSessionId: manifest.sessionId } : {}),
      });
    }
  }

  return artifacts;
}

