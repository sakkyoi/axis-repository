import { ValidationError, type Repository, type RepositoryObjectStore } from "@axis-repository/core";
import { pypiPluginManifest } from "../manifest";
import type { ArtifactRepositoryPlugin } from "../../../packages/runtime-cloudflare/src/artifact-publisher-registry";
import { createPrefixServingPredicate } from "../../../packages/runtime-cloudflare/src/artifact-publisher-registry";
import { GenericManifestPublisher } from "../../../packages/runtime-cloudflare/src/generic-manifest-publisher";

function validatePypiRepositoryConfig(config: Record<string, unknown>): void {
  const namespace = pypiPluginManifest.repositoryConfig.namespace;
  const pypi = config[namespace];
  if (pypi !== undefined && (!pypi || typeof pypi !== "object" || Array.isArray(pypi))) {
    throw new ValidationError(`config.${namespace} must be an object`);
  }
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function simpleUrl(origin: string, repository: Repository): string {
  return `${origin.replace(/\/+$/g, "")}/repositories/${repository.name}/simple/`;
}

export function createPypiPlugin(input?: { objectStore?: RepositoryObjectStore }): ArtifactRepositoryPlugin {
  const publisher = input?.objectStore
    ? new GenericManifestPublisher({ objectStore: input.objectStore })
    : { publish: async () => ({ publishedAt: new Date().toISOString(), objects: [] }) };
  return {
    ecosystem: "pypi",
    name: pypiPluginManifest.runtimeName,
    version: pypiPluginManifest.version,
    capabilities: [...pypiPluginManifest.capabilities],
    publisher,
    canServeRepositoryPath: createPrefixServingPredicate(["simple"]),
    validateRepositoryConfig: ({ config }) => validatePypiRepositoryConfig(config),
    validatePublishArtifacts: () => {},
    authorizePublish: () => {},
    clientHelpers: {
      namespace: pypiPluginManifest.clientHelpers.namespace,
      actions: pypiPluginManifest.clientHelpers.actions.map((action) => ({ ...action })),
      isPublic: (action) => action === "simple-url",
      handle: async ({ repository, action, origin }) => {
        if (action !== "simple-url") {
          throw new ValidationError(`PyPI client helper is not configured: ${action}`);
        }
        const url = simpleUrl(origin, repository);
        return jsonResponse({
          repository: repository.name,
          ecosystem: "pypi",
          simpleUrl: url,
          pipIndexUrl: url,
        });
      },
    },
  };
}
