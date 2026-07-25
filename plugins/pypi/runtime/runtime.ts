import type { RepositoryArtifactRecord, RepositoryObject, RepositoryObjectListItem, RepositoryObjectStore } from "@axis-repository/core";
import { pypiPluginManifest } from "../manifest";
import type { ArtifactRepositoryPlugin, DescribePublishedArtifactsInput, RebuildRepositoryArtifactIndexInput } from "@axis-repository/runtime-cloudflare/plugin-runtime";
import { createPrefixServingPredicate, GenericManifestPublisher } from "@axis-repository/runtime-cloudflare/plugin-runtime";
import { createPypiClientHelpers } from "./client-helpers";
import { validatePypiRepositoryConfig } from "./config";

export function createPypiPlugin(input?: { objectStore?: RepositoryObjectStore }): ArtifactRepositoryPlugin {
  const publisher = input?.objectStore
    ? new GenericManifestPublisher({ objectStore: input.objectStore })
    : { publish: async () => ({ publishedAt: new Date().toISOString(), objects: [] }) };
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

async function listAllObjects(objectStore: RepositoryObjectStore, prefix: string): Promise<RepositoryObjectListItem[]> {
  const objects: RepositoryObjectListItem[] = [];
  let cursor: string | undefined;
  do {
    const page = await objectStore.listObjects({
      prefix,
      ...(cursor ? { cursor } : {}),
    });
    objects.push(...page.objects);
    cursor = page.cursor;
  } while (cursor);
  return objects;
}

async function objectBytes(object: RepositoryObject): Promise<Uint8Array> {
  if (object.body instanceof Uint8Array) {
    return object.body;
  }
  if (typeof object.body === "string") {
    return new TextEncoder().encode(object.body);
  }
  const chunks: Uint8Array[] = [];
  const reader = object.body.getReader();
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    chunks.push(next.value);
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
