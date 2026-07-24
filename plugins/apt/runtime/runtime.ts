import { NotFoundError, ValidationError, type ArtifactPublisher, type Repository } from "@axis-repository/core";
import { aptPluginManifest } from "../manifest";
import type {
  ArtifactRepositoryPlugin,
  RepositorySigningKeyCapability,
  ValidateRepositoryConfigInput,
} from "@axis-repository/runtime-cloudflare/plugin-runtime";
import { createPrefixServingPredicate, readJsonObject, stringField } from "@axis-repository/runtime-cloudflare/plugin-runtime";
import { buildAptInstallInfo, buildAptSourceInfo, type AptClientRepositoryInfo } from "./client";
import { parseAptRepositoryConfig, validateAptPublishArtifacts } from "./metadata";

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

function requireAptSigningKeys(services: { signingKeys?: RepositorySigningKeyCapability }): RepositorySigningKeyCapability {
  if (!services.signingKeys) {
    throw new ValidationError("APT signing key capability is not configured");
  }
  return services.signingKeys;
}

async function requireRepositoryScopedSigningKey(
  signingKeys: RepositorySigningKeyCapability,
  repositoryName: string,
  signingKeyId: string,
) {
  const key = await signingKeys.getPublicKey(signingKeyId);
  if (key.repositoryName !== repositoryName) {
    throw new NotFoundError();
  }
  return key;
}

export function createAptPlugin(input: { publisher: ArtifactPublisher }): ArtifactRepositoryPlugin {
  return {
    ecosystem: "apt",
    name: aptPluginManifest.runtimeName,
    version: aptPluginManifest.version,
    capabilities: [...aptPluginManifest.capabilities],
    canServeRepositoryPath: createPrefixServingPredicate(["dists", "pool"]),
    validateRepositoryConfig: (configInput) => {
      parseAptRepositoryConfig(repositoryForConfig(configInput));
    },
    publish: {
      validateArtifacts: validateAptPublishArtifacts,
      derivePrincipalScope: (repository) => {
        const config = parseAptRepositoryConfig(repository);
        return {
          signingKeyIds: [config.signingKeyId],
        };
      },
      authorize: ({ repository, principal }) => {
        const config = parseAptRepositoryConfig(repository);
        if (!principal.signingKeyIds.includes(config.signingKeyId)) {
          throw new ValidationError("Publish token is not scoped to the repository signing key");
        }
      },
      finalize: (publishInput) => input.publisher.publish(publishInput),
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
    adminResources: {
      namespace: aptPluginManifest.repositoryConfig.namespace,
      handle: async ({ repositoryName, repository, request, path, services }) => {
        const signingKeys = requireAptSigningKeys(services);
        if (path.length === 1 && path[0] === "signing-keys" && request.method === "GET") {
          return jsonResponse({
            signingKeys: await signingKeys.listForRepository(repositoryName),
          });
        }
        if (path.length === 2 && path[0] === "signing-keys" && path[1] === "import" && request.method === "POST") {
          const body = await readJsonObject(request);
          const key = await signingKeys.create({
            repositoryName,
            name: stringField(body, "name"),
            privateKeyArmored: stringField(body, "privateKeyArmored"),
            passphrase: stringField(body, "passphrase"),
          });
          return jsonResponse(key, { status: 201 });
        }
        if (path.length === 2 && path[0] === "signing-keys" && path[1] === "generate" && request.method === "POST") {
          const body = await readJsonObject(request);
          const key = await signingKeys.generate({
            repositoryName,
            name: stringField(body, "name"),
            userIdName: stringField(body, "userIdName"),
            userIdEmail: stringField(body, "userIdEmail"),
          });
          return jsonResponse(key, { status: 201 });
        }
        if (path.length === 2 && path[0] === "signing-keys" && request.method === "GET") {
          return jsonResponse(await requireRepositoryScopedSigningKey(signingKeys, repositoryName, path[1]!));
        }
        if (path.length === 3 && path[0] === "signing-keys" && path[2] === "revoke" && request.method === "POST") {
          await requireRepositoryScopedSigningKey(signingKeys, repositoryName, path[1]!);
          return jsonResponse(await signingKeys.revoke(path[1]!));
        }
        throw new NotFoundError();
      },
    },
  };
}
