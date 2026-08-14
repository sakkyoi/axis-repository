import { NotFoundError, ValidationError, type RepositoryObjectStore } from "@axis-repository/core";
import type {
  RepositoryAdminResources,
  RepositorySigningKeyCapability,
} from "@axis-repository/runtime-cloudflare/plugin-runtime";
import { listAllObjects, pluginJsonResponse, readJsonObject, stringField } from "@axis-repository/runtime-cloudflare/plugin-runtime";
import { aptPluginManifest } from "../manifest";

function aptAdminResourceRoute(name: string) {
  const route = aptPluginManifest.adminResources.routes.find((candidate) => candidate.name === name);
  if (!route) {
    throw new Error(`APT admin resource manifest is not configured: ${name}`);
  }
  return { ...route, path: [...route.path] };
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

export function createAptAdminResources(input: {
  signingKeys: RepositorySigningKeyCapability;
}): RepositoryAdminResources {
  return {
    namespace: aptPluginManifest.adminResources.namespace,
    routes: [
      {
        ...aptAdminResourceRoute("list-signing-keys"),
        handle: async ({ repositoryName }) => {
          return pluginJsonResponse({
            signingKeys: await input.signingKeys.listForRepository(repositoryName),
          });
        },
      },
      {
        ...aptAdminResourceRoute("import-signing-key"),
        handle: async ({ repositoryName, request }) => {
          const body = await readJsonObject(request);
          const key = await input.signingKeys.create({
            repositoryName,
            name: stringField(body, "name"),
            privateKeyArmored: stringField(body, "privateKeyArmored"),
            passphrase: stringField(body, "passphrase"),
          });
          return pluginJsonResponse(key, { status: 201 });
        },
      },
      {
        ...aptAdminResourceRoute("generate-signing-key"),
        handle: async ({ repositoryName, request }) => {
          const body = await readJsonObject(request);
          const key = await input.signingKeys.generate({
            repositoryName,
            name: stringField(body, "name"),
            userIdName: stringField(body, "userIdName"),
            userIdEmail: stringField(body, "userIdEmail"),
          });
          return pluginJsonResponse(key, { status: 201 });
        },
      },
      {
        ...aptAdminResourceRoute("get-signing-key"),
        handle: async ({ repositoryName, params }) => {
          return pluginJsonResponse(await requireRepositoryScopedSigningKey(input.signingKeys, repositoryName, params.id!));
        },
      },
      {
        ...aptAdminResourceRoute("revoke-signing-key"),
        handle: async ({ repositoryName, params }) => {
          await requireRepositoryScopedSigningKey(input.signingKeys, repositoryName, params.id!);
          return pluginJsonResponse(await input.signingKeys.revoke(params.id!));
        },
      },
    ],
  };
}

export function createAptProxyAdminResources(input: {
  objectStoreFor?: (repositoryName: string) => RepositoryObjectStore;
  signingKeys?: RepositorySigningKeyCapability;
}): RepositoryAdminResources {
  const routes: RepositoryAdminResources["routes"] = [
    ...(input.signingKeys ? createAptAdminResources({ signingKeys: input.signingKeys }).routes : []),
  ];
  if (input.objectStoreFor) {
    const objectStoreFor = input.objectStoreFor;
    routes.push(
      {
        name: "get-proxy-cache",
        method: "GET",
        path: ["proxy-cache"],
        responseKind: "json",
        handle: async ({ repositoryName }) => {
          return pluginJsonResponse({ cache: await aptProxyByteCacheStats(objectStoreFor(repositoryName), repositoryName) });
        },
      },
      {
        name: "purge-proxy-cache",
        method: "POST",
        path: ["proxy-cache", "purge"],
        responseKind: "json",
        handle: async () => {
          throw new ValidationError("APT proxy byte cache purge must be queued by the runtime");
        },
      },
    );
  }

  return {
    namespace: aptPluginManifest.adminResources.namespace,
    routes,
  };
}

async function aptProxyByteCacheStats(
  objectStore: RepositoryObjectStore,
  repositoryName: string,
): Promise<{ fileCount: number; byteCount: number }> {
  const objects = await listAllObjects(objectStore, `repositories/${repositoryName}/_proxy-cache/apt/files/`);
  const files = objects.filter((object) => !object.key.endsWith(".json"));
  return {
    fileCount: files.length,
    byteCount: files.reduce((sum, object) => sum + (object.contentLength ?? 0), 0),
  };
}
