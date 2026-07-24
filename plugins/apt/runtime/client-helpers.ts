import type { Repository } from "@axis-repository/core";
import type {
  RepositoryClientHelpers,
  RepositorySigningKeyCapability,
} from "@axis-repository/runtime-cloudflare/plugin-runtime";
import { aptPluginManifest } from "../manifest";
import { buildAptInstallInfo, buildAptSourceInfo, type AptClientRepositoryInfo } from "./client";
import { parseAptRepositoryConfig } from "./metadata";

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

export function createAptClientHelpers(input: {
  signingKeys: RepositorySigningKeyCapability;
}): RepositoryClientHelpers {
  return {
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
  };
}
