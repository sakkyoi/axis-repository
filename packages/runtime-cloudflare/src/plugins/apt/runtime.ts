import { ValidationError, type ArtifactPublisher, type Repository } from "@axis-repository/core";
import { aptPluginManifest } from "@axis-repository/core/plugin-manifests";
import type { ArtifactRepositoryPlugin, ValidateRepositoryConfigInput } from "../../artifact-publisher-registry";
import { createPrefixServingPredicate } from "../../artifact-publisher-registry";
import { buildAptInstallInfo, buildAptSourceInfo, type AptClientRepositoryInfo } from "../../apt-client";
import { parseAptRepositoryConfig, validateAptPublishArtifacts } from "../../apt-metadata";

function repositoryForConfig(input: ValidateRepositoryConfigInput): Repository {
  return {
    id: "repo_validation",
    name: "repo-validation",
    ecosystem: input.ecosystem,
    visibility: "private",
    config: input.config,
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
  };
}

function aptClientRepositoryInfo(repository: Repository): AptClientRepositoryInfo {
  const config = parseAptRepositoryConfig(repository);
  return {
    name: repository.name,
    visibility: repository.visibility,
    codename: config.codename,
    components: config.components,
  };
}

function jsonResponse(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init?.headers ?? {}),
    },
  });
}

function repositoryCacheControl(repository: Repository): string {
  return repository.visibility === "public" ? "public, max-age=300" : "private, no-store";
}

function aptPublicKeyResponse(publicKeyArmored: string, repository: Repository): Response {
  const headers = new Headers();
  headers.set("content-type", "application/pgp-keys");
  headers.set("cache-control", repositoryCacheControl(repository));
  return new Response(publicKeyArmored, { headers });
}

export function createAptPlugin(input: { publisher: ArtifactPublisher }): ArtifactRepositoryPlugin {
  return {
    ecosystem: "apt",
    name: aptPluginManifest.runtimeName,
    version: aptPluginManifest.version,
    capabilities: [...aptPluginManifest.capabilities],
    publisher: input.publisher,
    canServeRepositoryPath: createPrefixServingPredicate(["dists", "pool"]),
    validateRepositoryConfig: (configInput) => {
      parseAptRepositoryConfig(repositoryForConfig(configInput));
    },
    validatePublishArtifacts: validateAptPublishArtifacts,
    authorizePublish: ({ repository, principal }) => {
      const config = parseAptRepositoryConfig(repository);
      if (!principal.signingKeyIds.includes(config.signingKeyId)) {
        throw new ValidationError("Publish token is not scoped to the repository signing key");
      }
    },
    clientHelpers: {
      namespace: aptPluginManifest.clientHelpers.namespace,
      actions: aptPluginManifest.clientHelpers.actions.map((action) => ({ ...action })),
      isPublic: (action) => action === "key.gpg" || action === "source" || action === "install",
      handle: async ({ repository, action, origin, signingKeys }) => {
        const repositoryInfo = aptClientRepositoryInfo(repository);
        if (action === "key.gpg") {
          const config = parseAptRepositoryConfig(repository);
          const key = await signingKeys.getPublicKey(config.signingKeyId);
          return aptPublicKeyResponse(key.publicKeyArmored, repository);
        }
        if (action === "source") {
          return jsonResponse(buildAptSourceInfo({ origin, repository: repositoryInfo }));
        }
        if (action === "install") {
          return jsonResponse(buildAptInstallInfo({ origin, repository: repositoryInfo }));
        }
        throw new ValidationError(`APT client helper is not configured: ${action}`);
      },
    },
  };
}
