import {
  flattenResolvedProxyOperationalPolicy,
  ValidationError,
  type ArtifactPublisher,
  type ProxyFileByteCachePolicy,
  type ProxyOperationalPolicy,
  type Repository,
  type RepositoryArtifactRecord,
  type RepositoryArtifactStore,
  type RepositoryObjectStore,
  resolveProxyOperationalPolicy,
} from "@axis-repository/core";
import { Decompress as ZstdDecompress } from "fzstd";
import { XzReadableStream } from "xz-decompress";
import { aptPluginManifest } from "../manifest";
import { parseStanzas, stanzaField } from "../shared/stanza";
import type {
  GroupRepositoryPlugin,
  HostedRepositoryPlugin,
  DescribePublishedArtifactsInput,
  ProxyRepositoryPlugin,
  ProvisionRepositoryCreateInput,
  RebuildRepositoryArtifactIndexInput,
  RebuildRepositoryArtifactIndexOutput,
  RepositoryObjectBrowser,
  RepositoryObjectBrowserListing,
  RepositoryMaintenanceInput,
  RepositorySigningKeyCapability,
  ValidateRepositoryCreateProvisioningInput,
  ValidateRepositoryConfigInput,
} from "@axis-repository/runtime-cloudflare/plugin-runtime";
import {
  createPrefixServingPredicate,
  digestHex,
  listAllObjects,
  objectBytes,
  objectStream,
} from "@axis-repository/runtime-cloudflare/plugin-runtime";
import { createAptAdminResources, createAptProxyAdminResources } from "./admin-resources";
import { createAptClientHelpers, createAptGroupClientHelpers, createAptProxyClientHelpers } from "./client-helpers";
import {
  normalizeAptGroupRepositoryConfig,
  normalizeAptProxyRepositoryConfig,
  parseAptGroupRepositoryConfig,
  parseAptProxyRepositoryConfig,
} from "./config";
import { writeAptRepositoryIndexes, type AptReleaseSigner } from "./index-store";
import {
  buildAptIndexMetadata,
  parseAptRepositoryConfig,
  validateAptPublishArtifacts,
} from "./metadata";
import { renewAptReleaseSignatures } from "./maintenance";
import { buildPackageStanza, indexKey, packageStanzaMetadata, type AptSuiteIndexes } from "./packages";
import { reconcileAptRepository } from "./rebuild";

export { AptSigningKeyResource } from "./signing-keys";

function repositoryForConfig(input: ValidateRepositoryConfigInput): Repository {
  return {
    id: "repo_validation",
    name: "repo-validation",
    ecosystem: input.ecosystem,
    kind: "hosted",
    visibility: "private",
    config: input.config,
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
  };
}

export function createAptPlugin(input: {
  publisher: ArtifactPublisher;
  signingKeys: RepositorySigningKeyCapability;
  signer: AptReleaseSigner;
}): HostedRepositoryPlugin {
  return {
    kind: "hosted",
    ecosystem: "apt",
    name: aptPluginManifest.runtimeName,
    version: aptPluginManifest.version,
    repositoryKinds: [{ kind: "hosted", experimental: false }],
    capabilities: [...aptPluginManifest.capabilities],
    canServeRepositoryPath: createPrefixServingPredicate(["dists", "pool"]),
    validateRepositoryConfig: (configInput) => {
      parseAptRepositoryConfig(repositoryForConfig(configInput));
    },
    create: {
      validateProvisioning: validateAptCreateProvisioning,
      provision: (provisionInput) => provisionAptRepository(input.signingKeys, provisionInput),
    },
    publish: {
      validateArtifacts: validateAptPublishArtifacts,
      derivePrincipalScope: (repository) => {
        const config = parseAptRepositoryConfig(repository);
        return {
          signingKeyIds: config.signing.mode === "axis" ? [config.signing.signingKeyId] : [],
        };
      },
      authorize: ({ repository, principal }) => {
        const config = parseAptRepositoryConfig(repository);
        if (config.signing.mode === "axis" && !principal.signingKeyIds.includes(config.signing.signingKeyId)) {
          throw new ValidationError("Publish token is not scoped to the repository signing key");
        }
      },
      finalize: (publishInput) => input.publisher.publish(publishInput),
      describeArtifacts: describeAptArtifacts,
    },
    artifacts: {
      rebuildIndex: (rebuildInput: RebuildRepositoryArtifactIndexInput) =>
        reconcileAptRepository({
          ...rebuildInput,
          signingKeys: input.signingKeys,
          signer: input.signer,
        }),
    },
    maintenance: {
      run: (maintenanceInput: RepositoryMaintenanceInput) =>
        renewAptReleaseSignatures({
          ...maintenanceInput,
          signingKeys: input.signingKeys,
          signer: input.signer,
        }),
    },
    clientHelpers: createAptClientHelpers({ signingKeys: input.signingKeys }),
    adminResources: createAptAdminResources({ signingKeys: input.signingKeys }),
  };
}

type FetchLike = (request: Request) => Promise<Response>;

const APT_PROXY_UPSTREAM_REQUEST_HEADERS = [
  "accept",
  "range",
  "if-range",
  "if-none-match",
  "if-modified-since",
] as const;
const APT_PROXY_CONFIG_PROBE_TIMEOUT_MS = 5000;
const APT_PROXY_CONFIG_PROBE_MAX_BYTES = 512 * 1024;

export function createAptProxyPlugin(input: {
  fetch?: FetchLike;
  objectStoreFor?: (repositoryName: string) => RepositoryObjectStore;
  signingKeys?: RepositorySigningKeyCapability;
  signer?: AptReleaseSigner;
  proxyPolicyFor?: (repository: Repository) => Promise<ProxyOperationalPolicy> | ProxyOperationalPolicy;
} = {}): ProxyRepositoryPlugin {
  const fetchImpl = input.fetch ?? ((request: Request) => fetch(request));
  const fileCacheWrites = new Map<string, Promise<void>>();
  return {
    kind: "proxy",
    ecosystem: "apt",
    name: `${aptPluginManifest.runtimeName}-proxy`,
    version: aptPluginManifest.version,
    repositoryKinds: [{ kind: "proxy", experimental: false }],
    capabilities: ["apt", "proxy", "serve:dists", "serve:pool"],
    canServeRepositoryPath: createPrefixServingPredicate(["dists", "pool"]),
    clientHelpers: createAptProxyClientHelpers({
      fetch: fetchImpl,
      ...(input.signingKeys ? { signingKeys: input.signingKeys } : {}),
    }),
    ...(input.objectStoreFor || input.signingKeys
      ? {
        adminResources: createAptProxyAdminResources({
          ...(input.objectStoreFor ? { objectStoreFor: input.objectStoreFor } : {}),
          ...(input.signingKeys ? { signingKeys: input.signingKeys } : {}),
        }),
      }
      : {}),
    objectBrowser: createAptProxyObjectBrowser(),
    normalizeRepositoryConfig: ({ config }) => normalizeAptProxyRepositoryConfig(config),
    create: {
      validateProvisioning: validateAptCreateProvisioning,
      provision: (provisionInput) => provisionAptRepository(requireAptProxySigningKeys(input), provisionInput),
    },
    serveRepositoryPath: async ({ repository, request, relativePath, backgroundTasks }) => {
      const upstream = parseAptProxyRepositoryConfig(repository.config);
      const proxyPolicy = await aptProxyPolicyForRepository(input, repository);
      const objectStore = input.objectStoreFor?.(repository.name);
      if (upstream.signing.mode !== "upstream" && relativePath.startsWith("dists/") && objectStore) {
        const stored = await objectStore.getObject(aptRepositoryObjectKey(repository.name, relativePath));
        if (stored) {
          return new Response(request.method === "HEAD" ? null : objectStream(stored), {
            headers: aptProxyStoredIndexHeaders(stored.contentType),
          });
        }
      }
      const upstreamUrl = aptProxyUpstreamUrl(upstream.upstreamUrl, relativePath);
      const cacheableRequest = objectStore !== undefined
        && proxyPolicy.fileByteCache.enabled
        && (request.method === "GET" || request.method === "HEAD")
        && !request.headers.has("range")
        && !hasAptProxyConditionalRequestHeaders(request.headers);
      if (cacheableRequest) {
        const cached = await readAptProxyFileCache({
          objectStore: objectStore!,
          repositoryName: repository.name,
          upstreamUrl,
          method: request.method,
          policy: proxyPolicy.fileByteCache,
        });
        if (cached) {
          return cached;
        }
        const write = fileCacheWrites.get(aptProxyFileCacheLeaseKey(repository.name, upstreamUrl));
        if (write) {
          await write;
          const completed = await readAptProxyFileCache({
            objectStore: objectStore!,
            repositoryName: repository.name,
            upstreamUrl,
            method: request.method,
            policy: proxyPolicy.fileByteCache,
          });
          if (completed) {
            return completed;
          }
        }
      }
      const headers = new Headers();
      for (const name of APT_PROXY_UPSTREAM_REQUEST_HEADERS) {
        const value = request.headers.get(name);
        if (value) {
          headers.set(name, value);
        }
      }
      const upstreamResponse = await fetchImpl(new Request(upstreamUrl, {
        method: request.method,
        headers,
      }));
      if (cacheableRequest
        && request.method === "GET"
        && upstreamResponse.status === 200
        && aptProxyFileResponseCanBeCached(upstreamResponse.headers, proxyPolicy.fileByteCache)) {
        return streamAndCacheAptProxyFileResponse({
          objectStore: objectStore!,
          repositoryName: repository.name,
          upstreamUrl,
          response: upstreamResponse,
          fileCacheWrites,
          policy: proxyPolicy.fileByteCache,
          ...(backgroundTasks ? { backgroundTasks } : {}),
        });
      }
      return new Response(request.method === "HEAD" ? null : upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: proxyResponseHeaders(upstreamResponse.headers),
      });
    },
    artifacts: {
      rebuildIndex: async (rebuildInput) => rebuildAptProxyArtifactIndex({
        ...rebuildInput,
        fetch: fetchImpl,
        ...(input.signingKeys ? { signingKeys: input.signingKeys } : {}),
        ...(input.signer ? { signer: input.signer } : {}),
        proxyPolicy: await aptProxyPolicyForRepository(input, rebuildInput.repository),
      }),
    },
    validateRepositoryConfig: async ({ config }) => {
      await validateAptProxyRepositoryConfigWithProbe(config, fetchImpl);
    },
  };
}

async function aptProxyPolicyForRepository(
  input: { proxyPolicyFor?: (repository: Repository) => Promise<ProxyOperationalPolicy> | ProxyOperationalPolicy },
  repository: Repository,
): Promise<ProxyOperationalPolicy> {
  const repositoryConfig = parseAptProxyRepositoryConfig(repository.config);
  if (input.proxyPolicyFor) {
    return flattenResolvedProxyOperationalPolicy(resolveProxyOperationalPolicy({
      deployment: await input.proxyPolicyFor(repository),
      ...(repositoryConfig.proxyPolicy === undefined ? {} : { repository: repositoryConfig.proxyPolicy }),
    }));
  }
  return flattenResolvedProxyOperationalPolicy(resolveProxyOperationalPolicy(
    repositoryConfig.proxyPolicy === undefined ? {} : { repository: repositoryConfig.proxyPolicy },
  ));
}

async function validateAptProxyRepositoryConfigWithProbe(
  config: Record<string, unknown>,
  fetchImpl: FetchLike,
): Promise<void> {
  const upstream = parseAptProxyRepositoryConfig(config);
  const releaseUrl = aptProxyUpstreamUrl(upstream.upstreamUrl, `dists/${upstream.codename}/Release`);
  let response: Response;
  try {
    response = await fetchOnceWithTimeout(fetchImpl, new Request(releaseUrl, {
      headers: { accept: "text/plain, */*;q=0.2" },
    }), APT_PROXY_CONFIG_PROBE_TIMEOUT_MS);
  } catch (error) {
    throw new ValidationError(
      `config.apt.upstreamUrl could not be verified as an APT repository: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) {
    throw new ValidationError(`config.apt.upstreamUrl could not be verified as an APT repository: upstream returned ${response.status} for ${releaseUrl}`);
  }
  const text = await readResponseTextLimit(response, APT_PROXY_CONFIG_PROBE_MAX_BYTES);
  const stanza = parseStanzas(text)[0];
  if (!stanza || !aptProxyLooksLikeReleaseStanza(stanza)) {
    throw new ValidationError(`config.apt.upstreamUrl does not publish APT Release metadata at ${releaseUrl}`);
  }
}

function aptProxyLooksLikeReleaseStanza(stanza: ReturnType<typeof parseStanzas>[number]): boolean {
  return Boolean(
    stanzaField(stanza, "SHA256")
      || stanzaField(stanza, "SHA512")
      || stanzaField(stanza, "MD5Sum")
      || (stanzaField(stanza, "Components") && stanzaField(stanza, "Architectures")),
  );
}

function createAptProxyObjectBrowser(): RepositoryObjectBrowser {
  return {
    listObjects: async ({ repository, objectStore, repositoryArtifactStore, prefix, cursor, limit }) => {
      if (prefix === "") {
        const directories = new Map([
          ["dists/", { name: "dists", path: "dists/" }],
        ]);
        if (repositoryArtifactStore) {
          const virtual = aptProxyVirtualArtifactBrowserList(await repositoryArtifactStore.listByRepository(repository.name), { prefix });
          for (const directory of virtual.directories) {
            directories.set(directory.path, directory);
          }
        }
        return {
          prefix,
          directories: [...directories.values()].sort((left, right) => left.name.localeCompare(right.name)),
          objects: [],
          truncated: false,
        };
      }
      if (!repositoryArtifactStore) {
        if (prefix === "dists/" || prefix.startsWith("dists/")) {
          return aptProxyStoredObjectBrowserList({
            repository,
            objectStore,
            prefix,
            ...(cursor !== undefined ? { cursor } : {}),
            ...(limit !== undefined ? { limit } : {}),
          });
        }
        return null;
      }
      const virtualListing = aptProxyVirtualArtifactBrowserList(
        await repositoryArtifactStore.listByRepository(repository.name),
        {
          prefix,
          ...(cursor !== undefined ? { cursor } : {}),
          ...(limit !== undefined ? { limit } : {}),
        },
      );
      if (prefix === "dists/" || prefix.startsWith("dists/")) {
        const stored = await aptProxyStoredObjectBrowserList({
          repository,
          objectStore,
          prefix,
          ...(cursor !== undefined ? { cursor } : {}),
          ...(limit !== undefined ? { limit } : {}),
        });
        return mergeAptProxyObjectBrowserListings(stored, virtualListing);
      }
      if (virtualListing.directories.length > 0 || virtualListing.objects.length > 0 || prefix === "pool/" || prefix.startsWith("pool/")) {
        return virtualListing;
      }
      return null;
    },
    getObjectDetail: async ({ repository, repositoryArtifactStore, path, origin }) => {
      if (!repositoryArtifactStore) {
        return null;
      }
      const artifacts = await repositoryArtifactStore.listByRepository(repository.name);
      const artifact = artifacts.find((candidate) => aptProxyArtifactFilename(candidate) === path);
      if (!artifact) {
        return null;
      }
      const name = path.split("/").pop() ?? path;
      const size = metadataNumber(artifact.metadata, "size");
      return {
        name,
        path,
        objectKey: `virtual:apt-proxy:${path}`,
        repositoryUrl: `${origin}/repositories/${encodeURIComponent(repository.name)}/${path.split("/").map(encodeURIComponent).join("/")}`,
        contentType: "application/vnd.debian.binary-package",
        ...(size !== undefined ? { size } : {}),
      };
    },
  };
}

async function aptProxyStoredObjectBrowserList(input: {
  repository: Repository;
  objectStore: RepositoryObjectStore;
  prefix: string;
  cursor?: string;
  limit?: number;
}): Promise<RepositoryObjectBrowserListing> {
  const repositoryPrefix = `repositories/${input.repository.name}/`;
  const listing = await input.objectStore.listObjects({
    prefix: `${repositoryPrefix}${input.prefix}`,
    delimiter: "/",
    ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
  });
  return {
    prefix: input.prefix,
    directories: listing.directories.map((directory) => {
      const relative = directory.path.slice(repositoryPrefix.length);
      return {
        name: relative.replace(/\/$/u, "").split("/").pop() ?? relative,
        path: relative,
      };
    }),
    objects: listing.objects.map((object) => {
      const path = object.key.slice(repositoryPrefix.length);
      return {
        name: path.split("/").pop() ?? path,
        path,
        ...(object.contentLength !== undefined ? { size: object.contentLength } : {}),
        ...(object.contentType ? { contentType: object.contentType } : {}),
        ...(object.etag ? { etag: object.etag } : {}),
      };
    }),
    ...(listing.cursor ? { cursor: listing.cursor } : {}),
    truncated: listing.truncated,
  };
}

function aptProxyVirtualArtifactBrowserList(
  artifacts: RepositoryArtifactRecord[],
  input: { prefix: string; cursor?: string; limit?: number },
): RepositoryObjectBrowserListing {
  const normalizedPrefix = input.prefix === "" || input.prefix.endsWith("/") ? input.prefix : `${input.prefix}/`;
  const directories = new Map<string, { name: string; path: string }>();
  const objects: Array<{ name: string; path: string; size?: number; contentType: string }> = [];
  for (const artifact of artifacts) {
    const filename = aptProxyArtifactFilename(artifact);
    if (!filename || !filename.startsWith(normalizedPrefix)) {
      continue;
    }
    const rest = filename.slice(normalizedPrefix.length);
    if (rest === "") {
      continue;
    }
    const slash = rest.indexOf("/");
    if (slash >= 0) {
      const name = rest.slice(0, slash);
      directories.set(name, { name, path: `${normalizedPrefix}${name}/` });
      continue;
    }
    const size = metadataNumber(artifact.metadata, "size");
    objects.push({
      name: rest,
      path: filename,
      ...(size !== undefined ? { size } : {}),
      contentType: "application/vnd.debian.binary-package",
    });
  }
  const page = aptProxyBrowserPage([
    ...[...directories.values()].sort((left, right) => left.name.localeCompare(right.name)).map((directory) => ({ kind: "directory" as const, value: directory })),
    ...objects.sort((left, right) => left.name.localeCompare(right.name)).map((object) => ({ kind: "object" as const, value: object })),
  ], input);
  return {
    prefix: input.prefix,
    directories: page.items.filter((item) => item.kind === "directory").map((item) => item.value),
    objects: page.items.filter((item) => item.kind === "object").map((item) => item.value),
    ...(page.cursor ? { cursor: page.cursor } : {}),
    truncated: page.truncated,
  };
}

function aptProxyArtifactFilename(artifact: RepositoryArtifactRecord): string | undefined {
  const filename = typeof artifact.metadata.filename === "string" ? artifact.metadata.filename : undefined;
  const key = artifact.primaryObjectKey ?? artifact.objectKeys[0];
  const value = filename ?? key;
  return value && !value.startsWith("/") && !value.includes("..") ? value : undefined;
}

function mergeAptProxyObjectBrowserListings(
  stored: RepositoryObjectBrowserListing,
  virtual: RepositoryObjectBrowserListing,
): RepositoryObjectBrowserListing {
  const directories = new Map<string, { name: string; path: string }>();
  for (const directory of [...stored.directories, ...virtual.directories]) {
    directories.set(directory.path, directory);
  }
  const objects = new Map<string, typeof stored.objects[number]>();
  for (const object of [...stored.objects, ...virtual.objects]) {
    objects.set(object.path, object);
  }
  return {
    prefix: stored.prefix,
    directories: [...directories.values()].sort((left, right) => left.name.localeCompare(right.name)),
    objects: [...objects.values()].sort((left, right) => left.name.localeCompare(right.name)),
    ...(stored.cursor ?? virtual.cursor ? { cursor: stored.cursor ?? virtual.cursor } : {}),
    truncated: stored.truncated || virtual.truncated,
  };
}

function metadataNumber(metadata: Record<string, unknown>, field: string): number | undefined {
  const value = metadata[field];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function aptProxyBrowserPage<T>(
  values: T[],
  input: { cursor?: string; limit?: number },
): { items: T[]; cursor?: string; truncated: boolean } {
  const offset = aptProxyBrowserCursorOffset(input.cursor);
  const limit = input.limit && input.limit > 0 ? input.limit : values.length;
  const end = Math.min(offset + limit, values.length);
  const truncated = end < values.length;
  return {
    items: values.slice(offset, end),
    ...(truncated ? { cursor: `offset:${end}` } : {}),
    truncated,
  };
}

function aptProxyBrowserCursorOffset(cursor: string | undefined): number {
  if (!cursor?.startsWith("offset:")) {
    return 0;
  }
  const offset = Number(cursor.slice("offset:".length));
  return Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
}

async function rebuildAptProxyArtifactIndex(input: RebuildRepositoryArtifactIndexInput & {
  fetch: FetchLike;
  signingKeys?: RepositorySigningKeyCapability;
  signer?: AptReleaseSigner;
  proxyPolicy: ProxyOperationalPolicy;
}): Promise<{ artifacts: RepositoryArtifactRecord[]; complete: true; progress: { message: string }; reset: true }> {
  const config = parseAptProxyRepositoryConfig(input.repository.config);
  const releasePath = `dists/${config.codename}/Release`;
  const releaseText = await fetchAptProxyIndexText(input.fetch, aptProxyUpstreamUrl(config.upstreamUrl, releasePath), input.proxyPolicy);
  const indexPaths = aptProxyPackagesIndexPaths(releaseText, config);
  const artifacts: RepositoryArtifactRecord[] = [];
  const stanzasByIndex: AptSuiteIndexes = new Map();

  for (const index of indexPaths) {
    const text = await fetchAptProxyPackagesText(input.fetch, aptProxyUpstreamUrl(config.upstreamUrl, `dists/${config.codename}/${index.path}`), input.proxyPolicy, index.path);
    const uncompressedPath = `dists/${config.codename}/${index.path.replace(/\.(gz|xz|zst)$/u, "")}`;
    const stanzas = parseStanzas(text);
    if (config.signing.mode === "upstream") {
      await input.objectStore.putText(
        aptRepositoryObjectKey(input.repository.name, uncompressedPath),
        text,
        "text/plain; charset=utf-8",
      );
    } else {
      stanzasByIndex.set(indexKey(index.component, index.architecture), {
        component: index.component,
        architecture: index.architecture,
        stanzas,
      });
    }
    for (const stanza of stanzas) {
      const artifact = aptProxyArtifactRecord({
        repository: input.repository,
        stanza,
        component: index.component,
        indexedAt: input.now.toISOString(),
      });
      if (artifact) {
        artifacts.push(artifact);
      }
    }
  }

  if (config.signing.mode === "upstream") {
    await input.objectStore.putText(
      aptRepositoryObjectKey(input.repository.name, releasePath),
      releaseText,
      "text/plain; charset=utf-8",
    );
  } else {
    const resolvedConfig = aptProxyResolvedIndexConfig({
      repositoryName: input.repository.name,
      config,
      releaseText,
      indexPaths,
    });
    const publishedAt = input.now.toISOString();
    const suite = await buildAptIndexMetadata({
      repositoryName: input.repository.name,
      config: resolvedConfig,
      suite: config.codename,
      stanzasByIndex,
      publishDate: publishedAt,
    });
    await writeAptRepositoryIndexes({
      objectStore: input.objectStore,
      repositoryName: input.repository.name,
      suites: [suite],
      ...(config.signing.mode === "axis"
        ? {
          signing: {
            signer: requireAptProxySigner(input),
            signingKey: await requireAptProxySigningKeys(input).getActivePrivateKey(config.signing.signingKeyId, input.repository.name),
          },
        }
        : {}),
      publishedAt,
    });
  }

  return {
    artifacts,
    complete: true,
    reset: true,
    progress: { message: `Indexed ${artifacts.length} APT package records` },
  };
}

function aptProxyResolvedIndexConfig(input: {
  repositoryName: string;
  config: ReturnType<typeof parseAptProxyRepositoryConfig>;
  releaseText: string;
  indexPaths: Array<{ path: string; component: string; architecture: string }>;
}) {
  const release = parseStanzas(input.releaseText)[0];
  if (!release) {
    throw new ValidationError("APT proxy upstream Release metadata is empty");
  }
  const components = input.config.components
    ?? uniqueNonEmpty(input.indexPaths.map((index) => index.component))
    ?? splitReleaseList(stanzaField(release, "Components"));
  const architectures = input.config.architectures
    ?? uniqueNonEmpty(input.indexPaths.map((index) => index.architecture))
    ?? splitReleaseList(stanzaField(release, "Architectures"));
  return {
    codename: input.config.codename,
    suites: [input.config.codename],
    components: components.length > 0 ? components : ["main"],
    architectures: architectures.length > 0 ? architectures : ["amd64"],
    signing: input.config.signing.mode === "axis"
      ? { mode: "axis" as const, signingKeyId: input.config.signing.signingKeyId }
      : { mode: "unsigned" as const },
  };
}

function uniqueNonEmpty(values: string[]): string[] | undefined {
  const unique = [...new Set(values.filter(Boolean))];
  return unique.length > 0 ? unique : undefined;
}

function requireAptProxySigner(input: { signer?: AptReleaseSigner }): AptReleaseSigner {
  if (!input.signer) {
    throw new ValidationError("APT proxy axis signing is not configured");
  }
  return input.signer;
}

function requireAptProxySigningKeys(input: { signingKeys?: RepositorySigningKeyCapability }): RepositorySigningKeyCapability {
  if (!input.signingKeys) {
    throw new ValidationError("APT proxy axis signing keys are not configured");
  }
  return input.signingKeys;
}

function aptProxyPackagesIndexPaths(
  releaseText: string,
  config: ReturnType<typeof parseAptProxyRepositoryConfig>,
): Array<{ path: string; component: string; architecture: string }> {
  const stanza = parseStanzas(releaseText)[0];
  if (!stanza) {
    return [];
  }
  const components = new Set(config.components ?? splitReleaseList(stanzaField(stanza, "Components")));
  const architectures = new Set(config.architectures ?? splitReleaseList(stanzaField(stanza, "Architectures")));
  const byIndex = new Map<string, { path: string; component: string; architecture: string; score: number }>();
  const checksums = stanzaField(stanza, "SHA256") ?? stanzaField(stanza, "SHA512") ?? stanzaField(stanza, "MD5Sum") ?? "";
  for (const line of checksums.split("\n")) {
    const match = /^\s*[A-Fa-f0-9]+\s+\d+\s+(.+?\/binary-([^/]+)\/Packages(?:\.(gz|xz|zst))?)\s*$/u.exec(line);
    if (!match) {
      continue;
    }
    const path = match[1] ?? "";
    const architecture = match[2] ?? "";
    const component = path.split("/")[0] ?? "";
    if ((components.size > 0 && !components.has(component)) || (architectures.size > 0 && !architectures.has(architecture))) {
      continue;
    }
    const base = path.replace(/\.(gz|xz|zst)$/u, "");
    const score = aptProxyPackagesPathScore(path);
    const current = byIndex.get(base);
    if (!current || score < current.score) {
      byIndex.set(base, { path, component, architecture, score });
    }
  }
  return [...byIndex.values()]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map(({ score: _score, ...index }) => index);
}

function aptProxyPackagesPathScore(path: string): number {
  if (path.endsWith("/Packages")) return 0;
  if (path.endsWith("/Packages.gz")) return 1;
  if (path.endsWith("/Packages.xz")) return 2;
  if (path.endsWith("/Packages.zst")) return 3;
  return 4;
}

function splitReleaseList(value: string | undefined): string[] {
  return (value ?? "").split(/\s+/u).map((item) => item.trim()).filter(Boolean);
}

async function fetchAptProxyIndexText(fetchImpl: FetchLike, url: string, policy: ProxyOperationalPolicy): Promise<string> {
  const response = await fetchOnceWithTimeout(fetchImpl, new Request(url, {
    headers: { accept: "text/plain, */*;q=0.2" },
  }), policy.upstreamFetchTimeoutMs);
  if (!response.ok) {
    throw new Error(`APT proxy upstream returned ${response.status} for ${url}`);
  }
  return response.text();
}

async function fetchAptProxyPackagesText(
  fetchImpl: FetchLike,
  url: string,
  policy: ProxyOperationalPolicy,
  path: string,
): Promise<string> {
  const response = await fetchOnceWithTimeout(fetchImpl, new Request(url, {
    headers: { accept: "text/plain, application/octet-stream;q=0.5, */*;q=0.1" },
  }), policy.upstreamFetchTimeoutMs);
  if (!response.ok) {
    throw new Error(`APT proxy upstream returned ${response.status} for ${url}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  return new TextDecoder().decode(await decompressAptProxyPackagesBytes(bytes, path));
}

async function decompressAptProxyPackagesBytes(bytes: Uint8Array, path: string): Promise<Uint8Array> {
  if (path.endsWith(".gz")) {
    return streamBytes(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")));
  }
  if (path.endsWith(".xz")) {
    return streamBytes(new XzReadableStream(new Blob([bytes]).stream()) as unknown as ReadableStream<Uint8Array>);
  }
  if (path.endsWith(".zst")) {
    return zstdBytes(bytes);
  }
  return bytes;
}

function zstdBytes(bytes: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [];
  const decompressor = new ZstdDecompress((chunk) => chunks.push(chunk as Uint8Array));
  decompressor.push(bytes, true);
  const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function streamBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      chunks.push(next.value);
      size += next.value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function aptProxyArtifactRecord(input: {
  repository: Repository;
  stanza: ReturnType<typeof parseStanzas>[number];
  component: string;
  indexedAt: string;
}): RepositoryArtifactRecord | null {
  const packageName = stanzaField(input.stanza, "Package");
  const version = stanzaField(input.stanza, "Version");
  const architecture = stanzaField(input.stanza, "Architecture");
  const filename = stanzaField(input.stanza, "Filename");
  if (!packageName || !version || !architecture || !filename) {
    return null;
  }
  const size = Number(stanzaField(input.stanza, "Size"));
  const sha256 = stanzaField(input.stanza, "SHA256");
  const metadata: Record<string, unknown> = {
    ...packageStanzaMetadata(input.stanza),
    source: "proxy",
    component: input.component,
    filename,
    ...(Number.isSafeInteger(size) && size >= 0 ? { size } : {}),
    ...(sha256 ? { sha256 } : {}),
  };
  const identityParts = ["apt", input.component, packageName, version, architecture];
  return {
    id: `artifact_${input.repository.name}_${identityParts.join("_")}`,
    repositoryName: input.repository.name,
    ecosystem: input.repository.ecosystem,
    identity: identityParts.join(":"),
    family: ["apt", input.component, packageName].join(":"),
    name: packageName,
    version,
    summary: `${packageName} ${version} ${architecture}`,
    primaryObjectKey: filename,
    objectKeys: [filename],
    metadata,
    publishedAt: input.indexedAt,
    updatedAt: input.indexedAt,
  };
}

function aptProxyUpstreamUrl(upstreamBaseUrl: string, relativePath: string): string {
  return new URL(relativePath.replace(/^\/+/u, ""), upstreamBaseUrl).toString();
}

function aptRepositoryObjectKey(repositoryName: string, relativePath: string): string {
  return `repositories/${repositoryName}/${relativePath.replace(/^\/+/u, "")}`;
}

function aptProxyStoredIndexHeaders(contentType: string | undefined): Headers {
  const headers = new Headers();
  headers.set("content-type", contentType ?? "text/plain; charset=utf-8");
  headers.set("cache-control", "public, max-age=300");
  return headers;
}

interface AptProxyFileCacheMetadata {
  upstreamUrl: string;
  contentType: string;
  contentLength: number;
  cachedAt: string;
  etag?: string;
  lastModified?: string;
  acceptRanges?: string;
  cacheControl?: string;
}

async function aptProxyFileCacheObjectKey(repositoryName: string, upstreamUrl: string): Promise<string> {
  const digest = await digestHex("SHA-256", new TextEncoder().encode(upstreamUrl));
  return `repositories/${repositoryName}/_proxy-cache/apt/files/${digest}`;
}

async function aptProxyFileCacheMetadataKey(repositoryName: string, upstreamUrl: string): Promise<string> {
  return `${await aptProxyFileCacheObjectKey(repositoryName, upstreamUrl)}.json`;
}

function aptProxyFileCacheLeaseKey(repositoryName: string, upstreamUrl: string): string {
  return `${repositoryName}\0${upstreamUrl}`;
}

function aptProxyByteCachePrefix(repositoryName: string): string {
  return `repositories/${repositoryName}/_proxy-cache/apt/files/`;
}

async function readAptProxyFileCache(input: {
  objectStore: RepositoryObjectStore;
  repositoryName: string;
  upstreamUrl: string;
  method: string;
  policy: ProxyFileByteCachePolicy;
}): Promise<Response | null> {
  const objectKey = await aptProxyFileCacheObjectKey(input.repositoryName, input.upstreamUrl);
  const object = await input.objectStore.getObject(objectKey);
  if (!object) {
    return null;
  }
  const metadata = await readAptProxyFileCacheMetadata(input);
  if (aptProxyFileCacheIsExpired(metadata, input.policy)) {
    await input.objectStore.deleteObjects([objectKey, await aptProxyFileCacheMetadataKey(input.repositoryName, input.upstreamUrl)]);
    return null;
  }
  return new Response(input.method === "HEAD" ? null : objectStream(object), {
    status: 200,
    headers: aptProxyFileCacheHeaders(metadata, object),
  });
}

async function streamAndCacheAptProxyFileResponse(input: {
  objectStore: RepositoryObjectStore;
  repositoryName: string;
  upstreamUrl: string;
  response: Response;
  fileCacheWrites: Map<string, Promise<void>>;
  policy: ProxyFileByteCachePolicy;
  backgroundTasks?: { waitUntil(task: Promise<unknown>): void };
}): Promise<Response> {
  if (!input.response.body || !input.backgroundTasks) {
    return cacheAptProxyFileResponse(input);
  }
  const [clientBody, cacheBody] = input.response.body.tee();
  const cacheResponse = new Response(cacheBody, {
    status: input.response.status,
    statusText: input.response.statusText,
    headers: input.response.headers,
  });
  const leaseKey = aptProxyFileCacheLeaseKey(input.repositoryName, input.upstreamUrl);
  const task = cacheAptProxyFileResponse({ ...input, response: cacheResponse })
    .then(() => undefined)
    .catch((error) => {
      console.error(`APT proxy file cache write failed: ${error instanceof Error ? error.message : String(error)}`);
    })
    .finally(() => {
      input.fileCacheWrites.delete(leaseKey);
    });
  input.fileCacheWrites.set(leaseKey, task);
  input.backgroundTasks.waitUntil(task);
  return new Response(clientBody, {
    status: input.response.status,
    statusText: input.response.statusText,
    headers: proxyResponseHeaders(input.response.headers),
  });
}

async function cacheAptProxyFileResponse(input: {
  objectStore: RepositoryObjectStore;
  repositoryName: string;
  upstreamUrl: string;
  response: Response;
  policy: ProxyFileByteCachePolicy;
}): Promise<Response> {
  const contentType = input.response.headers.get("content-type") ?? "application/octet-stream";
  const objectKey = await aptProxyFileCacheObjectKey(input.repositoryName, input.upstreamUrl);
  const writer = await input.objectStore.createPartWriter(objectKey, contentType);
  try {
    if (input.response.body) {
      await writeReadableStreamToPartWriter(input.response.body, writer);
    }
    const { size } = await writer.complete();
    const metadata: AptProxyFileCacheMetadata = {
      upstreamUrl: input.upstreamUrl,
      contentType,
      contentLength: size,
      cachedAt: new Date().toISOString(),
      ...(input.response.headers.get("etag") ? { etag: input.response.headers.get("etag")! } : {}),
      ...(input.response.headers.get("last-modified") ? { lastModified: input.response.headers.get("last-modified")! } : {}),
      ...(input.response.headers.get("accept-ranges") ? { acceptRanges: input.response.headers.get("accept-ranges")! } : {}),
      ...(input.response.headers.get("cache-control") ? { cacheControl: input.response.headers.get("cache-control")! } : {}),
    };
    await input.objectStore.putJson(await aptProxyFileCacheMetadataKey(input.repositoryName, input.upstreamUrl), metadata);
    await enforceAptProxyFileCacheBudget(input.objectStore, input.repositoryName, input.policy);
    return await readAptProxyFileCache({
      objectStore: input.objectStore,
      repositoryName: input.repositoryName,
      upstreamUrl: input.upstreamUrl,
      method: "GET",
      policy: input.policy,
    }) ?? new Response(null, {
      status: input.response.status,
      statusText: input.response.statusText,
      headers: proxyResponseHeaders(input.response.headers),
    });
  } catch (error) {
    await writer.abort().catch(() => undefined);
    throw error;
  }
}

async function writeReadableStreamToPartWriter(
  stream: ReadableStream<Uint8Array>,
  writer: { write(chunk: Uint8Array): Promise<void> },
): Promise<void> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) {
        return;
      }
      await writer.write(result.value);
    }
  } finally {
    reader.releaseLock();
  }
}

async function readAptProxyFileCacheMetadata(input: {
  objectStore: RepositoryObjectStore;
  repositoryName: string;
  upstreamUrl: string;
}): Promise<AptProxyFileCacheMetadata | null> {
  const object = await input.objectStore.getObject(await aptProxyFileCacheMetadataKey(input.repositoryName, input.upstreamUrl));
  if (!object) {
    return null;
  }
  const metadata = parseAptProxyFileCacheMetadataObject(new TextDecoder().decode(await objectBytes(object)));
  return metadata.upstreamUrl === input.upstreamUrl ? metadata : null;
}

function parseAptProxyFileCacheMetadataObject(value: string | Record<string, unknown>): AptProxyFileCacheMetadata {
  const parsed = typeof value === "string" ? parseJsonObject(value) : value;
  return {
    upstreamUrl: typeof parsed.upstreamUrl === "string" ? parsed.upstreamUrl : "",
    contentType: typeof parsed.contentType === "string" ? parsed.contentType : "application/octet-stream",
    contentLength: typeof parsed.contentLength === "number" ? parsed.contentLength : 0,
    cachedAt: typeof parsed.cachedAt === "string" ? parsed.cachedAt : "",
    ...(typeof parsed.etag === "string" ? { etag: parsed.etag } : {}),
    ...(typeof parsed.lastModified === "string" ? { lastModified: parsed.lastModified } : {}),
    ...(typeof parsed.acceptRanges === "string" ? { acceptRanges: parsed.acceptRanges } : {}),
    ...(typeof parsed.cacheControl === "string" ? { cacheControl: parsed.cacheControl } : {}),
  };
}

function aptProxyFileCacheHeaders(
  metadata: AptProxyFileCacheMetadata | null,
  object: { contentType?: string; contentLength?: number; etag?: string },
): Headers {
  const headers = new Headers();
  const contentType = metadata?.contentType ?? object.contentType;
  if (contentType) headers.set("content-type", contentType);
  const contentLength = metadata?.contentLength ?? object.contentLength;
  if (contentLength !== undefined) headers.set("content-length", String(contentLength));
  const etag = metadata?.etag ?? object.etag;
  if (etag) headers.set("etag", etag);
  if (metadata?.lastModified) headers.set("last-modified", metadata.lastModified);
  if (metadata?.acceptRanges) headers.set("accept-ranges", metadata.acceptRanges);
  if (metadata?.cacheControl) headers.set("cache-control", metadata.cacheControl);
  return headers;
}

function aptProxyFileCacheIsExpired(
  metadata: AptProxyFileCacheMetadata | null,
  policy: ProxyFileByteCachePolicy,
): boolean {
  if (policy.ttlSeconds <= 0 || !metadata?.cachedAt) {
    return false;
  }
  const cachedAt = new Date(metadata.cachedAt).getTime();
  return !Number.isFinite(cachedAt) || Date.now() - cachedAt > policy.ttlSeconds * 1000;
}

async function enforceAptProxyFileCacheBudget(
  objectStore: RepositoryObjectStore,
  repositoryName: string,
  policy: ProxyFileByteCachePolicy,
): Promise<void> {
  if (policy.maxTotalBytes <= 0) {
    return;
  }
  const listing = await listAllObjects(objectStore, aptProxyByteCachePrefix(repositoryName));
  const files = await Promise.all(listing
    .filter((object) => !object.key.endsWith(".json"))
    .map(async (object) => {
      const metadataObject = await objectStore.getObject(`${object.key}.json`);
      const metadata = metadataObject
        ? parseAptProxyFileCacheMetadataObject(new TextDecoder().decode(await objectBytes(metadataObject)))
        : null;
      return {
        key: object.key,
        metadataKey: `${object.key}.json`,
        byteCount: object.contentLength ?? metadata?.contentLength ?? 0,
        cachedAt: metadata?.cachedAt ? new Date(metadata.cachedAt).getTime() : object.uploadedAt?.getTime() ?? 0,
      };
    }));
  let total = files.reduce((sum, file) => sum + file.byteCount, 0);
  if (total <= policy.maxTotalBytes) {
    return;
  }
  const deleting: string[] = [];
  for (const file of files.sort((left, right) => left.cachedAt - right.cachedAt)) {
    if (total <= policy.maxTotalBytes) break;
    deleting.push(file.key, file.metadataKey);
    total -= file.byteCount;
  }
  if (deleting.length > 0) {
    await objectStore.deleteObjects(deleting);
  }
}

function hasAptProxyConditionalRequestHeaders(headers: Headers): boolean {
  return headers.has("if-none-match")
    || headers.has("if-modified-since")
    || headers.has("if-match")
    || headers.has("if-unmodified-since");
}

function aptProxyFileResponseCanBeCached(headers: Headers, policy: ProxyFileByteCachePolicy): boolean {
  const contentLength = parseAptProxyFileCacheContentLength(headers.get("content-length"));
  if (contentLength === undefined || contentLength > policy.maxBytes) {
    return false;
  }
  const cacheControl = headers.get("cache-control");
  if (!cacheControl || !policy.respectUpstreamCacheControl) {
    return true;
  }
  const directives = cacheControl.toLowerCase().split(",").map((directive) => directive.trim());
  return !directives.some((directive) =>
    directive === "private"
    || directive === "no-store"
    || directive === "no-cache"
    || directive === "max-age=0"
    || directive === "s-maxage=0");
}

function parseAptProxyFileCacheContentLength(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

async function fetchOnceWithTimeout(fetchImpl: FetchLike, request: Request, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error(`APT proxy upstream request timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  try {
    return await fetchImpl(new Request(request, { signal: controller.signal }));
  } finally {
    clearTimeout(timeout);
  }
}

async function readResponseTextLimit(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) {
    return "";
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let complete = false;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) {
        complete = true;
        break;
      }
      const remaining = maxBytes - total;
      const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value;
      chunks.push(chunk);
      total += chunk.byteLength;
      if (value.byteLength > remaining) {
        break;
      }
    }
  } finally {
    if (!complete) {
      await reader.cancel().catch(() => undefined);
    }
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function proxyResponseHeaders(upstreamHeaders: Headers): Headers {
  const headers = new Headers(upstreamHeaders);
  for (const name of ["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]) {
    headers.delete(name);
  }
  return headers;
}

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function createAptGroupPlugin(input: {
  signingKeys: RepositorySigningKeyCapability;
  signer: AptReleaseSigner;
}): GroupRepositoryPlugin {
  return {
    kind: "group",
    ecosystem: "apt",
    name: `${aptPluginManifest.runtimeName}-group`,
    version: aptPluginManifest.version,
    repositoryKinds: [{ kind: "group", experimental: false }],
    capabilities: ["apt", "group"],
    canServeRepositoryPath: createPrefixServingPredicate(["dists", "pool"]),
    clientHelpers: createAptGroupClientHelpers({ signingKeys: input.signingKeys }),
    getGroupMembers: ({ repository }) => parseAptGroupRepositoryConfig(repository.config).members,
    normalizeRepositoryConfig: ({ config }) => normalizeAptGroupRepositoryConfig(config),
    validateRepositoryConfig: validateAptGroupRepositoryConfig,
    create: {
      validateProvisioning: validateAptCreateProvisioning,
      provision: (provisionInput) => provisionAptRepository(input.signingKeys, provisionInput),
    },
    objectBrowser: createAptGroupObjectBrowser(),
    artifacts: {
      rebuildIndex: (rebuildInput) =>
        rebuildAptGroupArtifactIndex({
          ...rebuildInput,
          signingKeys: input.signingKeys,
          signer: input.signer,
        }),
    },
    serveRepositoryPath: serveAptGroupRepositoryPath,
  };
}

function createAptGroupObjectBrowser(): RepositoryObjectBrowser {
  return {
    listObjects: async ({ repository, repositoryArtifactStore, prefix, cursor, limit }) => {
      if (!repositoryArtifactStore) {
        return null;
      }
      if (prefix === "") {
        return {
          prefix,
          directories: [
            { name: "dists", path: "dists/" },
            { name: "pool", path: "pool/" },
          ],
          objects: [],
          truncated: false,
        };
      }
      const listing = aptProxyVirtualArtifactBrowserList(
        await repositoryArtifactStore.listByRepository(repository.name),
        {
          prefix,
          ...(cursor !== undefined ? { cursor } : {}),
          ...(limit !== undefined ? { limit } : {}),
        },
      );
      return listing.directories.length > 0 || listing.objects.length > 0 || prefix === "pool/" || prefix.startsWith("pool/")
        ? listing
        : null;
    },
    getObjectDetail: async ({ repository, repositoryArtifactStore, path, origin }) => {
      if (!repositoryArtifactStore) {
        return null;
      }
      const artifacts = await repositoryArtifactStore.listByRepository(repository.name);
      const artifact = artifacts.find((candidate) => aptProxyArtifactFilename(candidate) === path);
      if (!artifact) {
        return null;
      }
      const name = path.split("/").pop() ?? path;
      const size = metadataNumber(artifact.metadata, "size");
      return {
        name,
        path,
        objectKey: artifact.primaryObjectKey ?? artifact.objectKeys[0] ?? `virtual:apt-group:${path}`,
        repositoryUrl: `${origin}/repositories/${encodeURIComponent(repository.name)}/${path.split("/").map(encodeURIComponent).join("/")}`,
        contentType: "application/vnd.debian.binary-package",
        ...(size !== undefined ? { size } : {}),
      };
    },
  };
}

const APT_GROUP_INDEX_SLICE_LIMIT = 250;

async function rebuildAptGroupArtifactIndex(
  input: RebuildRepositoryArtifactIndexInput & {
    signingKeys: RepositorySigningKeyCapability;
    signer: AptReleaseSigner;
  },
): Promise<RebuildRepositoryArtifactIndexOutput> {
  const group = parseAptGroupRepositoryConfig(input.repository.config);
  if (!input.repositoryArtifactStore) {
    return [];
  }
  const claimedFamilies: Record<string, string> = {};
  const artifacts: RepositoryArtifactRecord[] = [];

  for (const memberName of group.members) {
    let offset = 0;
    for (;;) {
      const page = await input.repositoryArtifactStore.listByRepositoryPage(memberName, {
        limit: APT_GROUP_INDEX_SLICE_LIMIT,
        offset,
      });
      for (const artifact of page.records) {
        const family = aptGroupSourceFamily(artifact);
        if (!family) {
          continue;
        }
        const claimedSource = claimedFamilies[family];
        if (!claimedSource) {
          claimedFamilies[family] = memberName;
        } else if (claimedSource !== memberName) {
          continue;
        }
        artifacts.push(aptGroupArtifactRecord(input.repository, memberName, artifact, `apt:group-package:${family}`));
      }
      offset += page.records.length;
      if (offset >= page.total || page.records.length === 0) {
        break;
      }
    }
  }

  await writeAptGroupIndexes({
    repository: input.repository,
    group,
    artifacts,
    objectStore: input.objectStore,
    signingKeys: input.signingKeys,
    signer: input.signer,
    publishedAt: input.now.toISOString(),
  });
  return artifacts;
}

async function serveAptGroupRepositoryPath(input: {
  repository: Repository;
  request: Request;
  relativePath: string;
  accept?: string;
  objectStore?: RepositoryObjectStore;
  repositories?: { getByName(name: string): Promise<Repository> };
  repositoryArtifactStore?: RepositoryArtifactStore;
  serveRepositoryPath?: (delegateInput: {
    repository: Repository;
    request: Request;
    relativePath: string;
    accept?: string;
  }) => Promise<Response | null>;
}): Promise<Response | null> {
  const group = parseAptGroupRepositoryConfig(input.repository.config);
  if (!input.repositories || !input.serveRepositoryPath) {
    return null;
  }
  if (input.relativePath === "dists" || input.relativePath.startsWith("dists/")) {
    if (!input.objectStore) {
      return null;
    }
    const key = aptRepositoryObjectKey(input.repository.name, input.relativePath);
    const stored = await input.objectStore.getObject(key);
    if (!stored) {
      return null;
    }
    return new Response(input.request.method === "HEAD" ? null : objectStream(stored), {
      headers: aptProxyStoredIndexHeaders(stored.contentType),
    });
  }
  const members = await Promise.all(group.members.map((name) => input.repositories!.getByName(name)));
  for (const member of members) {
    const response = await input.serveRepositoryPath({
      repository: member,
      request: input.request,
      relativePath: input.relativePath,
      ...(input.accept ? { accept: input.accept } : {}),
    });
    if (response && response.status !== 404) {
      return response;
    }
  }
  return null;
}

async function writeAptGroupIndexes(input: {
  repository: Repository;
  group: ReturnType<typeof parseAptGroupRepositoryConfig>;
  artifacts: RepositoryArtifactRecord[];
  objectStore: RepositoryObjectStore;
  signingKeys: RepositorySigningKeyCapability;
  signer: AptReleaseSigner;
  publishedAt: string;
}): Promise<void> {
  const stanzasByIndex: AptSuiteIndexes = new Map();
  for (const artifact of input.artifacts) {
    const stanza = aptGroupPackageStanza(artifact);
    if (!stanza) {
      continue;
    }
    const component = metadataString(artifact.metadata, "component") ?? "main";
    const architecture = metadataString(artifact.metadata, "architecture") ?? "all";
    const key = indexKey(component, architecture);
    const current = stanzasByIndex.get(key) ?? { component, architecture, stanzas: [] };
    current.stanzas.push(stanza);
    stanzasByIndex.set(key, current);
  }
  const components = input.group.components ?? uniqueNonEmpty([...stanzasByIndex.values()].map((index) => index.component)) ?? ["main"];
  const architectures = uniqueNonEmpty([...stanzasByIndex.values()].map((index) => index.architecture).filter((architecture) => architecture !== "all")) ?? ["all"];
  const suite = await buildAptIndexMetadata({
    repositoryName: input.repository.name,
    config: {
      codename: input.group.codename,
      suites: [input.group.codename],
      components,
      architectures,
      signing: input.group.signing,
    },
    suite: input.group.codename,
    stanzasByIndex,
    publishDate: input.publishedAt,
  });
  await writeAptRepositoryIndexes({
    objectStore: input.objectStore,
    repositoryName: input.repository.name,
    suites: [suite],
    ...(input.group.signing.mode === "axis"
      ? {
        signing: {
          signer: input.signer,
          signingKey: await input.signingKeys.getActivePrivateKey(input.group.signing.signingKeyId, input.repository.name),
        },
      }
      : {}),
    publishedAt: input.publishedAt,
  });
}

function aptGroupPackageStanza(artifact: RepositoryArtifactRecord) {
  const packageName = metadataString(artifact.metadata, "package") ?? artifact.name;
  const version = metadataString(artifact.metadata, "version") ?? artifact.version;
  const architecture = metadataString(artifact.metadata, "architecture");
  const maintainer = metadataString(artifact.metadata, "maintainer");
  const description = metadataString(artifact.metadata, "description");
  const filename = aptProxyArtifactFilename(artifact);
  const size = metadataNumber(artifact.metadata, "size");
  const sha256 = metadataString(artifact.metadata, "sha256");
  if (!packageName || !version || !architecture || !maintainer || !description || !filename || size === undefined || !sha256) {
    return null;
  }
  return buildPackageStanza({
    metadata: artifact.metadata,
    packageName,
    version,
    architecture,
    maintainer,
    description,
    filename,
    size,
    sha256,
  });
}

function aptGroupSourceFamily(artifact: RepositoryArtifactRecord): string | undefined {
  return artifact.family || undefined;
}

function aptGroupArtifactRecord(
  repository: Repository,
  sourceRepositoryName: string,
  artifact: RepositoryArtifactRecord,
  family: string,
): RepositoryArtifactRecord {
  return {
    ...artifact,
    id: `artifact_${repository.name}_group_${sourceRepositoryName}_${artifact.id}`,
    repositoryName: repository.name,
    family,
    metadata: {
      ...(artifact.metadata ?? {}),
      sourceRepositoryName,
      sourceArtifactId: artifact.id,
    },
  };
}

async function validateAptGroupRepositoryConfig(input: {
  config: Record<string, unknown>;
  repositoryName?: string;
  repositories?: { getByName(name: string): Promise<Repository> };
}): Promise<void> {
  const group = parseAptGroupRepositoryConfig(input.config);
  if (!input.repositories) {
    return;
  }
  for (const memberName of group.members) {
    if (memberName === input.repositoryName) {
      throw new ValidationError("config.apt.members cannot include the group repository itself");
    }
    const member = await input.repositories.getByName(memberName);
    if (member.ecosystem !== aptPluginManifest.ecosystem) {
      throw new ValidationError(`config.apt.members must reference APT repositories: ${memberName}`);
    }
    if (member.kind !== "hosted" && member.kind !== "proxy") {
      throw new ValidationError(`config.apt.members must reference hosted or proxy repositories: ${memberName}`);
    }
  }
}

function validateAptCreateProvisioning(input: ValidateRepositoryCreateProvisioningInput): void {
  parseAptSigningKeyProvisioning(input.provisioning);
}

async function provisionAptRepository(
  signingKeys: RepositorySigningKeyCapability,
  input: ProvisionRepositoryCreateInput,
): Promise<{ configPatch: Record<string, unknown> }> {
  const signingKey = parseAptSigningKeyProvisioning(input.provisioning);
  if (signingKey.mode === "existing") {
    const key = await signingKeys.getPublicKey(signingKey.signingKeyId);
    if (key.repositoryName !== input.repositoryName) {
      throw new ValidationError("Signing key is not scoped to this repository");
    }
    if (key.revokedAt) {
      throw new ValidationError("Signing key has been revoked");
    }
    return aptSigningKeyConfigPatch(key.id);
  }
  if (signingKey.mode === "import") {
    const key = await signingKeys.create({
      repositoryName: input.repositoryName,
      name: signingKey.name,
      privateKeyArmored: signingKey.privateKeyArmored,
      passphrase: signingKey.passphrase,
    });
    return aptSigningKeyConfigPatch(key.id);
  }
  const key = await signingKeys.generate({
    repositoryName: input.repositoryName,
    name: signingKey.name,
    userIdName: signingKey.userIdName,
    userIdEmail: signingKey.userIdEmail,
  });
  return aptSigningKeyConfigPatch(key.id);
}

function aptSigningKeyConfigPatch(signingKeyId: string): { configPatch: Record<string, unknown> } {
  return {
    configPatch: {
      apt: {
        signing: {
          mode: "axis",
          signingKeyId,
        },
      },
    },
  };
}

type AptSigningKeyProvisioning =
  | { mode: "generate"; name: string; userIdName: string; userIdEmail: string }
  | { mode: "import"; name: string; privateKeyArmored: string; passphrase: string }
  | { mode: "existing"; signingKeyId: string };

function parseAptSigningKeyProvisioning(provisioning: Record<string, unknown>): AptSigningKeyProvisioning {
  const apt = readRecord(provisioning.apt);
  const signingKey = readRecord(apt.signingKey);
  const mode = requiredProvisioningString(signingKey, "mode");
  if (mode === "existing") {
    return {
      mode,
      signingKeyId: requiredProvisioningString(signingKey, "signingKeyId"),
    };
  }
  if (mode === "import") {
    return {
      mode,
      name: requiredProvisioningString(signingKey, "name"),
      privateKeyArmored: requiredProvisioningString(signingKey, "privateKeyArmored"),
      passphrase: requiredProvisioningString(signingKey, "passphrase"),
    };
  }
  if (mode === "generate") {
    return {
      mode,
      name: requiredProvisioningString(signingKey, "name"),
      userIdName: requiredProvisioningString(signingKey, "userIdName"),
      userIdEmail: requiredProvisioningString(signingKey, "userIdEmail"),
    };
  }
  throw new ValidationError("Signing key provisioning mode is invalid");
}

function readRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function requiredProvisioningString(config: Record<string, unknown>, field: string): string {
  const value = config[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new ValidationError(`Signing key ${field} is required`);
  }
  return value;
}

function describeAptArtifacts(input: DescribePublishedArtifactsInput): RepositoryArtifactRecord[] {
  return input.session.artifacts.map((artifact) => {
    const packageName = metadataString(artifact.metadata, "package") ?? artifact.filename;
    const version = metadataString(artifact.metadata, "version");
    const architecture = metadataString(artifact.metadata, "architecture");
    const component = metadataString(artifact.metadata, "component") ?? "main";
    const primaryObjectKey = input.result.objects.find((object) =>
      object.key.includes("/pool/") && object.key.endsWith(`/${artifact.filename}`),
    )?.key;
    const identityParts = ["apt", component, packageName, version, architecture].filter((part): part is string =>
      Boolean(part),
    );
    const summaryParts = [packageName, version, architecture].filter((part): part is string => Boolean(part));
    return {
      id: `artifact_${input.repository.name}_${identityParts.join("_")}`,
      repositoryName: input.repository.name,
      ecosystem: input.repository.ecosystem,
      identity: identityParts.join(":"),
      // The package, without the version or the architecture it was built
      // for: a package is one thing that exists for several architectures,
      // the way `apt show` describes it, rather than one package per target.
      family: ["apt", component, packageName].filter((part): part is string => Boolean(part)).join(":"),
      name: packageName,
      ...(version ? { version } : {}),
      summary: summaryParts.join(" "),
      ...(primaryObjectKey ? { primaryObjectKey } : {}),
      objectKeys: primaryObjectKey ? [primaryObjectKey] : [],
      metadata: { ...artifact.metadata },
      publishedAt: input.result.publishedAt,
      updatedAt: input.result.publishedAt,
      publishSessionId: input.session.id,
    };
  });
}

function metadataString(metadata: Record<string, unknown>, field: string): string | undefined {
  const value = metadata[field];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
