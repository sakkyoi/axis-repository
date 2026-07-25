import type { RepositoryArtifactRecord, RepositoryObjectStore } from "@axis-repository/core";
import { pypiPluginManifest } from "../manifest";
import type { ArtifactRepositoryPlugin, DescribePublishedArtifactsInput } from "@axis-repository/runtime-cloudflare/plugin-runtime";
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
