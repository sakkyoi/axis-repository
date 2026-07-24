import { ValidationError, type Repository, type RepositoryObjectStore } from "@axis-repository/core";
import { pypiPluginManifest } from "../manifest";
import type { ArtifactRepositoryPlugin } from "@axis-repository/runtime-cloudflare/plugin-runtime";
import { createPrefixServingPredicate, GenericManifestPublisher } from "@axis-repository/runtime-cloudflare/plugin-runtime";

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

function pypiClientHelperAction(name: string) {
  const action = pypiPluginManifest.clientHelpers.actions.find((candidate) => candidate.name === name);
  if (!action) {
    throw new Error(`PyPI client helper manifest is not configured: ${name}`);
  }
  return { ...action };
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
    canServeRepositoryPath: createPrefixServingPredicate(["simple"]),
    validateRepositoryConfig: ({ config }) => validatePypiRepositoryConfig(config),
    publish: {
      validateArtifacts: () => {},
      authorize: () => {},
      finalize: (publishInput) => publisher.publish(publishInput),
    },
    clientHelpers: {
      namespace: pypiPluginManifest.clientHelpers.namespace,
      actions: [
        {
          ...pypiClientHelperAction("simple-url"),
          handle: async ({ repository, origin }) => {
            const url = simpleUrl(origin, repository);
            return jsonResponse({
              repository: repository.name,
              ecosystem: "pypi",
              simpleUrl: url,
              pipIndexUrl: url,
            });
          },
        },
      ],
    },
  };
}
