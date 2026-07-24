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

function aptClientHelperAction(name: string) {
  const action = aptPluginManifest.clientHelpers.actions.find((candidate) => candidate.name === name);
  if (!action) {
    throw new Error(`APT client helper manifest is not configured: ${name}`);
  }
  return { ...action };
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

export function createAptPlugin(input: {
  publisher: ArtifactPublisher;
  signingKeys: RepositorySigningKeyCapability;
}): ArtifactRepositoryPlugin {
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
      actions: [
        {
          ...aptClientHelperAction("key.gpg"),
          handle: async ({ repository }) => {
            const config = parseAptRepositoryConfig(repository);
            const key = await input.signingKeys.getPublicKey(config.signingKeyId);
            return aptPublicKeyResponse(key.publicKeyArmored, repository);
          },
        },
        {
          ...aptClientHelperAction("source"),
          handle: async ({ repository, origin }) =>
            jsonResponse(buildAptSourceInfo({ origin, repository: aptClientRepositoryInfo(repository) })),
        },
        {
          ...aptClientHelperAction("install"),
          handle: async ({ repository, origin }) =>
            jsonResponse(buildAptInstallInfo({ origin, repository: aptClientRepositoryInfo(repository) })),
        },
      ],
    },
    adminResources: {
      namespace: aptPluginManifest.repositoryConfig.namespace,
      routes: [
        {
          method: "GET",
          path: ["signing-keys"],
          handle: async ({ repositoryName }) => {
            return jsonResponse({
              signingKeys: await input.signingKeys.listForRepository(repositoryName),
            });
          },
        },
        {
          method: "POST",
          path: ["signing-keys", "import"],
          handle: async ({ repositoryName, request }) => {
            const body = await readJsonObject(request);
            const key = await input.signingKeys.create({
              repositoryName,
              name: stringField(body, "name"),
              privateKeyArmored: stringField(body, "privateKeyArmored"),
              passphrase: stringField(body, "passphrase"),
            });
            return jsonResponse(key, { status: 201 });
          },
        },
        {
          method: "POST",
          path: ["signing-keys", "generate"],
          handle: async ({ repositoryName, request }) => {
            const body = await readJsonObject(request);
            const key = await input.signingKeys.generate({
              repositoryName,
              name: stringField(body, "name"),
              userIdName: stringField(body, "userIdName"),
              userIdEmail: stringField(body, "userIdEmail"),
            });
            return jsonResponse(key, { status: 201 });
          },
        },
        {
          method: "GET",
          path: ["signing-keys", ":id"],
          handle: async ({ repositoryName, params }) => {
            return jsonResponse(await requireRepositoryScopedSigningKey(input.signingKeys, repositoryName, params.id!));
          },
        },
        {
          method: "POST",
          path: ["signing-keys", ":id", "revoke"],
          handle: async ({ repositoryName, params }) => {
            await requireRepositoryScopedSigningKey(input.signingKeys, repositoryName, params.id!);
            return jsonResponse(await input.signingKeys.revoke(params.id!));
          },
        },
      ],
    },
  };
}
