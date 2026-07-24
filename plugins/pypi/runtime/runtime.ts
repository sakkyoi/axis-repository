import type { RepositoryObjectStore } from "@axis-repository/core";
import { pypiPluginManifest } from "../manifest";
import type { ArtifactRepositoryPlugin } from "@axis-repository/runtime-cloudflare/plugin-runtime";
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
    },
    clientHelpers: createPypiClientHelpers(),
  };
}
