import { ValidationError, type Repository, type RepositoryObjectStore } from "@axis-repository/core";
import type { ArtifactRepositoryPlugin } from "../../artifact-publisher-registry";
import { createPrefixServingPredicate } from "../../artifact-publisher-registry";
import { GenericManifestPublisher } from "../../generic-manifest-publisher";

function validatePypiRepositoryConfig(config: Record<string, unknown>): void {
  const pypi = config.pypi;
  if (pypi !== undefined && (!pypi || typeof pypi !== "object" || Array.isArray(pypi))) {
    throw new ValidationError("config.pypi must be an object");
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
    name: "pypi-simple",
    version: "0.1.0",
    capabilities: ["pypi", "simple-api", "serve:simple", "client-helpers"],
    publisher,
    canServeRepositoryPath: createPrefixServingPredicate(["simple"]),
    validateRepositoryConfig: ({ config }) => validatePypiRepositoryConfig(config),
    validatePublishArtifacts: () => {},
    authorizePublish: () => {},
    clientHelpers: {
      namespace: "pypi",
      actions: [
        {
          name: "simple-url",
          label: "Simple API URL",
          responseKind: "text",
          defaultOpen: true,
          public: true,
          displayPath: "simpleUrl",
        },
      ],
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
