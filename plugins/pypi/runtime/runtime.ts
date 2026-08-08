import type {
  ProxyOperationalPolicy,
  ProxyFileByteCachePolicy,
  Repository,
  RepositoryArtifactRecord,
  RepositoryArtifactStore,
  RepositoryObjectStore,
} from "@axis-repository/core";
import {
  flattenResolvedProxyOperationalPolicy,
  resolveProxyOperationalPolicy,
  ValidationError,
} from "@axis-repository/core";
import { pypiPluginManifest } from "../manifest";
import type {
  GroupRepositoryPlugin,
  HostedRepositoryPlugin,
  DescribePublishedArtifactsInput,
  ProxyRepositoryPlugin,
  RebuildRepositoryArtifactIndexInput,
  RepositoryObjectBrowser,
  ValidatePublishArtifactsInput,
} from "@axis-repository/runtime-cloudflare/plugin-runtime";
import {
  createPrefixServingPredicate,
  digestHex,
  digestStreamHex,
  listAllObjects,
  objectBytes,
  objectStream,
} from "@axis-repository/runtime-cloudflare/plugin-runtime";
import {
  createPypiAdminResources,
  readPypiProxyCachedProject,
  readPypiProxyCachedProjectSummaries,
} from "./admin-resources";
import { createPypiClientHelpers } from "./client-helpers";
import { parsePypiProxyRepositoryConfig, validatePypiRepositoryConfig } from "./config";
import { readDistributionMetadata } from "./distribution-source";
import {
  CORE_METADATA_CONTENT_TYPE,
  PACKAGES_PREFIX,
  SERVED_PREFIXES,
  SIMPLE_PREFIX,
  coreMetadataKey,
  packageRelativePath,
  parsePackageRelativePath,
  resolveSimplePath,
} from "./layout";
import { parseProjectFilesHtml, parseProjectListHtml, readPublishedProjectFiles, writeSimpleIndexes } from "./index-store";
import { parseCoreMetadata, type PypiCoreMetadata } from "../shared/metadata";
import { escapeHtml, SIMPLE_JSON_CONTENT_TYPE, type SimpleProjectFile } from "./simple-index";
import {
  parseDistributionFilename,
  normalizeProjectName,
  requireDistributionFilename,
  type PypiDistributionFilename,
} from "../shared/names";
import { inValidationErrorsSync } from "./format";
import { PypiPublisher } from "./publisher";
import { createPypiUploadProtocol } from "./upload-protocol";

export function createPypiPlugin(input?: {
  objectStoreFor?: (repositoryName: string) => RepositoryObjectStore;
}): HostedRepositoryPlugin {
  // Without a store there is nowhere to write. Fail loudly rather than
  // reporting a successful publish that stored nothing.
  const publisher = input?.objectStoreFor
    ? new PypiPublisher({ objectStoreFor: input.objectStoreFor })
    : {
      publish: async (): Promise<never> => {
        throw new ValidationError("PyPI repository plugin was created without an object store");
      },
    };
  return {
    kind: "hosted",
    ecosystem: "pypi",
    name: pypiPluginManifest.runtimeName,
    version: pypiPluginManifest.version,
    repositoryKinds: ["hosted"],
    capabilities: [...pypiPluginManifest.capabilities],
    canServeRepositoryPath: createPrefixServingPredicate(SERVED_PREFIXES),
    uploadProtocol: createPypiUploadProtocol(),
    resolveRepositoryPath: ({ relativePath, accept }) => resolveSimplePath(relativePath, accept),
    validateRepositoryConfig: ({ config }) => validatePypiRepositoryConfig(config),
    publish: {
      validateArtifacts: validatePypiArtifacts,
      authorize: () => {},
      finalize: (publishInput) => publisher.publish(publishInput),
      describeArtifacts: describePypiArtifacts,
    },
    artifacts: {
      rebuildIndex: rebuildPypiArtifactIndex,
    },
    clientHelpers: createPypiClientHelpers(),
    ...(input?.objectStoreFor
      ? { adminResources: createPypiAdminResources({ objectStoreFor: input.objectStoreFor }) }
      : {}),
  };
}

type FetchLike = (request: Request) => Promise<Response>;
const PYPI_PROXY_UPSTREAM_REQUEST_HEADERS = [
  "accept",
  "range",
  "if-range",
  "if-none-match",
  "if-modified-since",
] as const;

export function createPypiProxyPlugin(input: {
  fetch?: FetchLike;
  objectStoreFor?: (repositoryName: string) => RepositoryObjectStore;
  proxyPolicyFor?: (repository: Repository) => Promise<ProxyOperationalPolicy> | ProxyOperationalPolicy;
} = {}): ProxyRepositoryPlugin {
  const fetchImpl = input.fetch ?? ((request: Request) => fetch(request));
  const fileCacheWrites = new Map<string, Promise<void>>();
  return {
    kind: "proxy",
    ecosystem: "pypi",
    name: `${pypiPluginManifest.runtimeName}-proxy`,
    version: pypiPluginManifest.version,
    repositoryKinds: ["proxy"],
    capabilities: ["pypi", "proxy"],
    canServeRepositoryPath: createPrefixServingPredicate([SIMPLE_PREFIX]),
    resolveRepositoryPath: ({ relativePath, accept }) => resolveSimplePath(relativePath, accept),
    clientHelpers: createPypiClientHelpers({ includeUpload: false }),
    ...(input.objectStoreFor
      ? {
        adminResources: createPypiAdminResources({
          objectStoreFor: input.objectStoreFor,
          fetchProxyProject: async ({ repository, repositoryName, repositoryEcosystem, repositoryConfig, artifactStore, project, cachedProject }) =>
            fetchAndCachePypiProxyProject({
              fetch: fetchImpl,
              objectStore: input.objectStoreFor!(repositoryName),
              artifactStore,
              repositoryName,
              repositoryEcosystem,
              repositoryConfig,
              proxyPolicy: await pypiProxyPolicyForRepository(input, repository),
              project,
              ...(cachedProject === undefined ? {} : { cachedProject }),
            }),
        }),
      }
      : {}),
    objectBrowser: createPypiProxyObjectBrowser(fetchImpl),
    artifacts: {
      rebuildIndex: async (rebuildInput) => rebuildPypiProxyArtifactIndex({
        ...rebuildInput,
        fetch: fetchImpl,
        proxyPolicy: await pypiProxyPolicyForRepository(input, rebuildInput.repository),
      }),
    },
    serveRepositoryPath: async ({ repository, request, relativePath, scheduleBackgroundTask }) => {
      const upstream = parsePypiProxyRepositoryConfig(repository.config);
      const proxyPolicy = await pypiProxyPolicyForRepository(input, repository);
      const objectStore = input.objectStoreFor?.(repository.name);
      const upstreamUrl = await pypiProxyServeUpstreamUrl({
        objectStore,
        repositoryName: repository.name,
        upstreamUrl: upstream.upstreamUrl,
        relativePath,
      });
      if (!upstreamUrl) {
        return null;
      }
      const proxyFile = pypiProxyFileFromRelativePath(relativePath);
      const cacheableFileRequest = proxyFile !== undefined
        && objectStore !== undefined
        && proxyPolicy.fileByteCache.enabled
        && !request.headers.has("range")
        && !hasPypiProxyConditionalRequestHeaders(request.headers);
      if (cacheableFileRequest && (request.method === "GET" || request.method === "HEAD")) {
        const cached = await readPypiProxyFileCache({
          objectStore: objectStore!,
          repositoryName: repository.name,
          upstreamUrl,
          method: request.method,
          policy: proxyPolicy.fileByteCache,
        });
        if (cached) {
          return cached;
        }
        const write = fileCacheWrites.get(pypiProxyFileCacheLeaseKey(repository.name, upstreamUrl));
        if (write) {
          await write;
          const completed = await readPypiProxyFileCache({
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
      for (const name of PYPI_PROXY_UPSTREAM_REQUEST_HEADERS) {
        const value = request.headers.get(name);
        if (value) {
          headers.set(name, value);
        }
      }
      const accept = request.headers.get("accept");
      const upstreamResponse = await fetchImpl(new Request(upstreamUrl, {
        method: request.method,
        headers,
      }));
      if (proxyFile !== undefined && request.method === "GET") {
        if (cacheableFileRequest
          && upstreamResponse.status === 200
          && pypiProxyFileResponseCanBeCached(upstreamResponse.headers, proxyPolicy.fileByteCache)) {
          return streamAndCachePypiProxyFileResponse({
            objectStore: objectStore!,
            repositoryName: repository.name,
            upstreamUrl,
            response: upstreamResponse,
            fileCacheWrites,
            policy: proxyPolicy.fileByteCache,
            ...(scheduleBackgroundTask ? { scheduleBackgroundTask } : {}),
          });
        }
        return new Response(upstreamResponse.body, {
          status: upstreamResponse.status,
          statusText: upstreamResponse.statusText,
          headers: proxyResponseHeaders(upstreamResponse.headers),
        });
      }
      const response = request.method === "GET"
        ? await rewritePypiProxySimpleResponse({
          repositoryName: repository.name,
          relativePath,
          accept,
          response: upstreamResponse,
        })
        : upstreamResponse;
      if (request.method === "GET" && upstreamResponse.ok) {
        await cachePypiProxyProjectResponse({
          objectStore,
          repositoryName: repository.name,
          relativePath,
          response: upstreamResponse,
        });
      }
      return new Response(request.method === "HEAD" ? null : response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: proxyResponseHeaders(response.headers),
      });
    },
    validateRepositoryConfig: ({ config }) => {
      parsePypiProxyRepositoryConfig(config);
    },
  };
}

async function pypiProxyPolicyForRepository(
  input: { proxyPolicyFor?: (repository: Repository) => Promise<ProxyOperationalPolicy> | ProxyOperationalPolicy },
  repository: Repository,
): Promise<ProxyOperationalPolicy> {
  const repositoryConfig = parsePypiProxyRepositoryConfig(repository.config);
  if (input.proxyPolicyFor) {
    const repositoryPolicy = repositoryConfig.proxyPolicy;
    return flattenResolvedProxyOperationalPolicy(resolveProxyOperationalPolicy({
      deployment: await input.proxyPolicyFor(repository),
      ...(repositoryPolicy === undefined ? {} : { repository: repositoryPolicy }),
    }));
  }
  return fallbackPypiProxyPolicy(repository.config);
}

function fallbackPypiProxyPolicy(repositoryConfig: Record<string, unknown>): ProxyOperationalPolicy {
  const config = parsePypiProxyRepositoryConfig(repositoryConfig);
  return flattenResolvedProxyOperationalPolicy(resolveProxyOperationalPolicy(
    config.proxyPolicy === undefined ? {} : { repository: config.proxyPolicy },
  ));
}

async function rewritePypiProxySimpleResponse(input: {
  repositoryName: string;
  relativePath: string;
  accept: string | null;
  response: Response;
}): Promise<Response> {
  if (!input.response.ok) {
    return input.response;
  }
  const contentType = input.response.headers.get("content-type") ?? "";
  const normalizedContentType = contentType.toLowerCase();
  if (normalizedContentType.includes(SIMPLE_JSON_CONTENT_TYPE)) {
    const rewritten = rewritePypiProxyProjectFilesJson(await input.response.clone().text());
    if (!rewritten) {
      return input.response;
    }
    const headers = proxyResponseHeaders(input.response.headers);
    headers.set("content-type", SIMPLE_JSON_CONTENT_TYPE);
    headers.delete("content-length");
    return new Response(rewritten, {
      status: input.response.status,
      statusText: input.response.statusText,
      headers,
    });
  }
  if (!normalizedContentType.includes("text/html")) {
    return input.response;
  }
  if (prefersPypiSimpleJson(input.accept)) {
    const html = await input.response.clone().text();
    const json = pypiProxyProjectFromRelativePath(input.relativePath)
      ? renderPypiProxyProjectFilesJson({
        project: pypiProxyProjectFromRelativePath(input.relativePath)!,
        files: parseProjectFilesHtml(html, { includeUrl: true }).map(({ url: _url, ...file }) => file),
      })
      : renderPypiProxyProjectListJson(parseProjectListHtml(html));
    const headers = proxyResponseHeaders(input.response.headers);
    headers.set("content-type", SIMPLE_JSON_CONTENT_TYPE);
    headers.delete("content-length");
    return new Response(json, {
      status: input.response.status,
      statusText: input.response.statusText,
      headers,
    });
  }
  const project = pypiProxyProjectFromRelativePath(input.relativePath);
  if (!project) {
    return input.response;
  }
  const files = parseProjectFilesHtml(await input.response.clone().text(), { includeUrl: true })
    .map(({ url: _url, ...file }) => file);
  if (files.length === 0) {
    return input.response;
  }
  const headers = proxyResponseHeaders(input.response.headers);
  headers.set("content-type", "text/html; charset=utf-8");
  headers.delete("content-length");
  return new Response(renderPypiProxyProjectFilesHtml({ project, files }), {
    status: input.response.status,
    statusText: input.response.statusText,
    headers,
  });
}

function prefersPypiSimpleJson(accept: string | null): boolean {
  if (!accept) {
    return false;
  }
  let jsonQuality = 0;
  let htmlQuality = 0;
  for (const entry of accept.split(",")) {
    const [type = "", ...parameters] = entry.trim().split(";").map((part) => part.trim());
    const quality = Number(parameters.find((parameter) => parameter.startsWith("q="))?.slice(2) ?? "1");
    if (!Number.isFinite(quality) || quality <= 0) {
      continue;
    }
    if (type === SIMPLE_JSON_CONTENT_TYPE) {
      jsonQuality = Math.max(jsonQuality, quality);
    } else if (type === "text/html" || type === "application/vnd.pypi.simple.v1+html" || type === "*/*") {
      htmlQuality = Math.max(htmlQuality, quality);
    }
  }
  return jsonQuality > 0 && jsonQuality >= htmlQuality;
}

function renderPypiProxyProjectListJson(projects: string[]): string {
  return `${JSON.stringify({
    meta: { "api-version": "1.0" },
    projects: [...projects].sort((left, right) => left.localeCompare(right)).map((name) => ({ name })),
  }, null, 2)}\n`;
}

function rewritePypiProxyProjectFilesJson(text: string): string | undefined {
  const parsed = parseJsonObject(text);
  const files = Array.isArray(parsed.files) ? parsed.files : undefined;
  if (!files) {
    return undefined;
  }
  return `${JSON.stringify({
    ...parsed,
    files: files.map((file) => {
      if (!isRecord(file) || typeof file.filename !== "string") {
        return file;
      }
      return {
        ...file,
        url: `./${encodeURIComponent(file.filename)}`,
      };
    }),
  }, null, 2)}\n`;
}

function renderPypiProxyProjectFilesJson(input: { project: string; files: SimpleProjectFile[] }): string {
  return `${JSON.stringify({
    meta: { "api-version": "1.0" },
    name: input.project,
    files: [...input.files]
      .sort((left, right) => left.filename.localeCompare(right.filename))
      .map((file) => ({
        filename: file.filename,
        url: `./${encodeURIComponent(file.filename)}`,
        hashes: { sha256: file.sha256 },
        ...(file.requiresPython ? { "requires-python": file.requiresPython } : {}),
        ...(file.coreMetadataSha256 ? { "core-metadata": { sha256: file.coreMetadataSha256 } } : {}),
        ...(file.yanked === undefined ? {} : { yanked: file.yanked === "" ? true : file.yanked }),
      })),
  }, null, 2)}\n`;
}

function renderPypiProxyProjectFilesHtml(input: { project: string; files: SimpleProjectFile[] }): string {
  const anchors = [...input.files]
    .sort((left, right) => left.filename.localeCompare(right.filename))
    .map((file) => {
      const attributes = [
        file.requiresPython ? ` data-requires-python="${escapeHtml(file.requiresPython)}"` : "",
        file.coreMetadataSha256 ? ` data-core-metadata="sha256=${file.coreMetadataSha256}"` : "",
        file.yanked === undefined ? "" : ` data-yanked="${escapeHtml(file.yanked)}"`,
      ].join("");
      const href = `./${encodeURIComponent(file.filename)}#sha256=${file.sha256}`;
      return `    <a href="${escapeHtml(href)}"${attributes}>${escapeHtml(file.filename)}</a><br />`;
    });
  return [
    "<!DOCTYPE html>",
    "<html>",
    "  <head>",
    "    <meta name=\"pypi:repository-version\" content=\"1.0\" />",
    `    <title>Links for ${escapeHtml(input.project)}</title>`,
    "  </head>",
    "  <body>",
    `    <h1>Links for ${escapeHtml(input.project)}</h1>`,
    ...anchors,
    "  </body>",
    "</html>",
    "",
  ].join("\n");
}

async function pypiProxyServeUpstreamUrl(input: {
  objectStore: RepositoryObjectStore | undefined;
  repositoryName: string;
  upstreamUrl: string;
  relativePath: string;
}): Promise<string | null> {
  const simpleUrl = pypiProxyUpstreamUrl(input.upstreamUrl, input.relativePath);
  if (simpleUrl) {
    return simpleUrl;
  }
  const match = /^simple\/([^/]+)\/([^/]+)$/u.exec(input.relativePath.replace(/\/+$/g, ""));
  if (!match || !input.objectStore) {
    return null;
  }
  const projectName = normalizeProjectName(match[1] ?? "");
  const filename = match[2] ?? "";
  const project = await readPypiProxyCachedProject(input.objectStore, input.repositoryName, projectName);
  const file = proxyProjectFiles(project?.files ?? []).find((candidate) => candidate.filename === filename);
  if (!file) {
    return null;
  }
  const projectUrl = pypiProxyUpstreamUrl(input.upstreamUrl, `${SIMPLE_PREFIX}/${projectName}/`);
  return projectUrl ? proxyProjectFileObjectKey(file, projectUrl) : null;
}

function pypiProxyFileFromRelativePath(relativePath: string): { projectName: string; filename: string } | undefined {
  const match = /^simple\/([^/]+)\/([^/]+)$/u.exec(relativePath.replace(/\/+$/g, ""));
  if (!match) {
    return undefined;
  }
  return {
    projectName: normalizeProjectName(match[1] ?? ""),
    filename: match[2] ?? "",
  };
}

function createPypiProxyObjectBrowser(_fetchImpl: FetchLike): RepositoryObjectBrowser {
  return {
    listObjects: async ({ repository, objectStore, prefix, cursor, limit }) => {
      if (prefix === "") {
        return {
          prefix,
          directories: [{ name: SIMPLE_PREFIX, path: `${SIMPLE_PREFIX}/` }],
          objects: [],
          truncated: false,
        };
      }
      if (prefix === `${SIMPLE_PREFIX}/`) {
        const projects = await readPypiProxyCachedProjectSummaries(objectStore, repository.name);
        const page = pypiProxyBrowserPage(projects, {
          ...(cursor !== undefined ? { cursor } : {}),
          ...(limit !== undefined ? { limit } : {}),
        });
        return {
          prefix,
          directories: page.items.map((project) => ({
            name: project.name,
            path: `${SIMPLE_PREFIX}/${project.name}/`,
          })),
          objects: [],
          ...(page.cursor ? { cursor: page.cursor } : {}),
          truncated: page.truncated,
        };
      }
      const projectPrefix = /^simple\/([^/]+)\/$/u.exec(prefix);
      if (!projectPrefix) {
        return null;
      }
      const projectName = normalizeProjectName(projectPrefix[1] ?? "");
      const project = await readPypiProxyCachedProject(objectStore, repository.name, projectName);
      if (!project) {
        return {
          prefix,
          directories: [],
          objects: [],
          truncated: false,
        };
      }
      const files = pypiProxyBrowserPage(proxyProjectFiles(project.files), {
        ...(cursor !== undefined ? { cursor } : {}),
        ...(limit !== undefined ? { limit } : {}),
      });
      return {
        prefix,
        directories: [],
        objects: files.items.map((file) => ({
          name: file.filename,
          path: `${SIMPLE_PREFIX}/${projectName}/${file.filename}`,
          contentType: "application/octet-stream",
        })),
        ...(files.cursor ? { cursor: files.cursor } : {}),
        truncated: files.truncated,
      };
    },
    getObjectDetail: async ({ repository, objectStore, path, origin }) => {
      const match = /^simple\/([^/]+)\/([^/]+)$/u.exec(path);
      if (!match) {
        return null;
      }
      const projectName = normalizeProjectName(match[1] ?? "");
      const filename = match[2] ?? "";
      const project = await readPypiProxyCachedProject(objectStore, repository.name, projectName);
      const file = proxyProjectFiles(project?.files ?? []).find((candidate) => candidate.filename === filename);
      if (!file) {
        return null;
      }
      return {
        name: file.filename,
        path,
        objectKey: `virtual:pypi-proxy:${path}`,
        repositoryUrl: `${origin}/repositories/${encodeURIComponent(repository.name)}/${path.split("/").map(encodeURIComponent).join("/")}`,
        contentType: "application/octet-stream",
      };
    },
  };
}

function pypiProxyBrowserPage<T>(
  values: T[],
  input: { cursor?: string; limit?: number },
): { items: T[]; cursor?: string; truncated: boolean } {
  const offset = pypiProxyBrowserCursorOffset(input.cursor);
  const limit = input.limit && input.limit > 0 ? input.limit : values.length;
  const end = Math.min(offset + limit, values.length);
  const truncated = end < values.length;
  return {
    items: values.slice(offset, end),
    ...(truncated ? { cursor: `offset:${end}` } : {}),
    truncated,
  };
}

function pypiProxyBrowserCursorOffset(cursor: string | undefined): number {
  if (!cursor) return 0;
  const match = /^offset:(\d+)$/u.exec(cursor);
  if (!match) {
    throw new ValidationError("PyPI proxy browser cursor is invalid");
  }
  return Number(match[1]);
}

function proxyProjectFiles(files: unknown[]): Array<{
  filename: string;
  url?: string;
  sha256?: string;
  requiresPython?: string;
  coreMetadataSha256?: string;
  yanked?: string;
}> {
  return files.filter((file): file is {
    filename: string;
    url?: string;
    sha256?: string;
    requiresPython?: string;
    coreMetadataSha256?: string;
    yanked?: string;
  } =>
    typeof file === "object"
    && file !== null
    && "filename" in file
    && typeof file.filename === "string",
  );
}

async function rebuildPypiProxyArtifactIndex(input: RebuildRepositoryArtifactIndexInput & {
  fetch: FetchLike;
  proxyPolicy: ProxyOperationalPolicy;
}) {
  const upstream = parsePypiProxyRepositoryConfig(input.repository.config);
  const rootUrl = pypiProxyUpstreamUrl(upstream.upstreamUrl, `${SIMPLE_PREFIX}/`);
  if (!rootUrl) {
    return {
      artifacts: [],
      complete: true,
    };
  }
  const continuationOffset = pypiProxyProjectOffset(input.continuation);
  const detailOffset = pypiProxyProjectDetailOffset(input.continuation);
  const rebuild = continuationOffset === undefined
    && detailOffset === undefined
    ? await startPypiProxyRebuild({
      fetch: input.fetch,
      objectStore: input.objectStore,
      repositoryName: input.repository.name,
      upstreamUrl: upstream.upstreamUrl,
      rootUrl,
      indexedAt: input.now.toISOString(),
      proxyPolicy: input.proxyPolicy,
    })
    : await readPypiProxyRebuild(input.objectStore, input.repository.name);
  if (!rebuild) {
    return {
      artifacts: [],
      complete: true,
      progress: { current: 0, total: 0 },
    };
  }
  if (detailOffset !== undefined) {
    return pypiProxyProjectDetailBatch({
      fetch: input.fetch,
      objectStore: input.objectStore,
      repositoryName: input.repository.name,
      repositoryEcosystem: input.repository.ecosystem,
      repositoryConfig: input.repository.config,
      indexedAt: input.now.toISOString(),
      projects: rebuild.projects,
      failedProjects: rebuild.failedProjects,
      offset: detailOffset,
      proxyPolicy: input.proxyPolicy,
    });
  }
  return pypiProxyProjectMarkerBatch({
    objectStore: input.objectStore,
    repositoryName: input.repository.name,
    repositoryEcosystem: input.repository.ecosystem,
    upstreamUrl: rebuild.upstreamUrl,
    rootUrl: rebuild.rootUrl,
    indexedAt: rebuild.indexedAt,
    projects: rebuild.projects,
    failedProjects: rebuild.failedProjects,
    offset: continuationOffset ?? 0,
    proxyPolicy: input.proxyPolicy,
  });
}

async function startPypiProxyRebuild(input: {
  fetch: FetchLike;
  objectStore: RepositoryObjectStore;
  repositoryName: string;
  upstreamUrl: string;
  rootUrl: string;
  indexedAt: string;
  proxyPolicy: ProxyOperationalPolicy;
}): Promise<PypiProxyRebuildCache> {
  const projects = await fetchPypiProxyProjects(input.fetch, input.rootUrl, input.proxyPolicy);
  const normalizedProjects = uniqueNormalizedProjects(projects);
  const rebuild: PypiProxyRebuildCache = {
    upstreamUrl: input.upstreamUrl,
    rootUrl: input.rootUrl,
    indexedAt: input.indexedAt,
    projects: normalizedProjects,
    failedProjects: [],
  };
  await input.objectStore.putJson(proxyCacheKey(input.repositoryName), {
    upstreamUrl: input.upstreamUrl,
    refreshedAt: input.indexedAt,
    projects: normalizedProjects.map((name) => ({ name })),
  });
  await removeStalePypiProxyProjectCache({
    objectStore: input.objectStore,
    repositoryName: input.repositoryName,
    projects: new Set(normalizedProjects),
  });
  await input.objectStore.putJson(proxyRebuildCacheKey(input.repositoryName), rebuild);
  return rebuild;
}

async function pypiProxyProjectMarkerBatch(input: {
  objectStore: RepositoryObjectStore;
  repositoryName: string;
  repositoryEcosystem: string;
  upstreamUrl: string;
  rootUrl: string;
  indexedAt: string;
  projects: string[];
  failedProjects: PypiProxyProjectFailure[] | undefined;
  offset: number;
  proxyPolicy: ProxyOperationalPolicy;
}) {
  const start = Math.max(0, input.offset);
  const end = Math.min(start + input.proxyPolicy.indexCatalogBatchSize, input.projects.length);
  const markerComplete = end >= input.projects.length;
  return {
    artifacts: input.projects.slice(start, end).map((project) => proxyProjectArtifactRecord({
      repositoryName: input.repositoryName,
      ecosystem: input.repositoryEcosystem,
      project,
      upstreamUrl: pypiProxyUpstreamUrl(input.upstreamUrl, `${SIMPLE_PREFIX}/${project}/`) ?? input.rootUrl,
      indexedAt: input.indexedAt,
      cacheStatus: "pending",
    })),
    complete: false,
    continuation: markerComplete ? { projectDetailOffset: 0 } : { projectOffset: end },
    progress: {
      current: end,
      total: input.projects.length * 2,
      message: markerComplete
        ? `Project catalog indexed. Warming ${input.projects.length} project details`
        : `Indexing project catalog ${end} of ${input.projects.length}`,
    },
    result: {
      proxyIndex: proxyIndexResult({
        phase: markerComplete ? "warming-project-details" : "indexing-project-catalog",
        projectCount: input.projects.length,
        warmedProjectCount: 0,
        failedProjects: input.failedProjects ?? [],
        failedProjectSampleLimit: input.proxyPolicy.failedProjectSampleLimit,
      }),
    },
  };
}

async function pypiProxyProjectDetailBatch(input: {
  fetch: FetchLike;
  objectStore: RepositoryObjectStore;
  repositoryName: string;
  repositoryEcosystem: string;
  repositoryConfig: Record<string, unknown>;
  indexedAt: string;
  projects: string[];
  failedProjects: PypiProxyProjectFailure[] | undefined;
  offset: number;
  proxyPolicy: ProxyOperationalPolicy;
}) {
  const upstream = parsePypiProxyRepositoryConfig(input.repositoryConfig);
  const rootUrl = pypiProxyUpstreamUrl(upstream.upstreamUrl, `${SIMPLE_PREFIX}/`) ?? "";
  const start = Math.max(0, input.offset);
  const end = Math.min(start + input.proxyPolicy.indexProjectDetailBatchSize, input.projects.length);
  const artifacts: RepositoryArtifactRecord[] = [];
  const failedProjects = [...(input.failedProjects ?? [])];
  let warmedProjectCount = start - failedProjects.length;
  for (const project of input.projects.slice(start, end)) {
    const result = await fetchAndCachePypiProxyProjectForWarming({
      fetch: input.fetch,
      objectStore: input.objectStore,
      repositoryName: input.repositoryName,
      repositoryConfig: input.repositoryConfig,
      proxyPolicy: input.proxyPolicy,
      project,
    });
    if (result.failure) {
      failedProjects.push(result.failure);
      artifacts.push(proxyProjectArtifactRecord({
        repositoryName: input.repositoryName,
        ecosystem: input.repositoryEcosystem,
        project,
        upstreamUrl: pypiProxyUpstreamUrl(upstream.upstreamUrl, `${SIMPLE_PREFIX}/${project}/`) ?? rootUrl,
        indexedAt: input.indexedAt,
        cacheStatus: "failed",
        lastCacheFailure: result.failure.message,
      }));
      continue;
    }
    const cachedProject = result.project;
    warmedProjectCount += 1;
    artifacts.push(...pypiProxyProjectArtifacts({
      repositoryName: input.repositoryName,
      repositoryEcosystem: input.repositoryEcosystem,
      repositoryConfig: input.repositoryConfig,
      indexedAt: input.indexedAt,
      project,
      files: cachedProject?.files ?? [],
    }));
  }
  const complete = end >= input.projects.length;
  if (complete) {
    await input.objectStore.deleteObject(proxyRebuildCacheKey(input.repositoryName));
  } else {
    await input.objectStore.putJson(proxyRebuildCacheKey(input.repositoryName), {
      upstreamUrl: upstream.upstreamUrl,
      rootUrl,
      indexedAt: input.indexedAt,
      projects: input.projects,
      failedProjects,
    } satisfies PypiProxyRebuildCache);
  }
  const failedCount = failedProjects.length;
  const phase = complete
    ? failedCount > 0 ? "complete-with-failures" : "complete"
    : "warming-project-details";
  return {
    artifacts,
    complete,
    ...(complete ? {} : { continuation: { projectDetailOffset: end } }),
    progress: {
      current: input.projects.length + end,
      total: input.projects.length * 2,
      message: failedCount > 0
        ? `Warmed project details ${warmedProjectCount} of ${input.projects.length}; ${failedCount} failed`
        : `Warmed project details ${end} of ${input.projects.length}`,
    },
    result: {
      proxyIndex: proxyIndexResult({
        phase,
        projectCount: input.projects.length,
        warmedProjectCount,
        failedProjects,
        failedProjectSampleLimit: input.proxyPolicy.failedProjectSampleLimit,
      }),
    },
  };
}

interface PypiProxyProjectFailure {
  project: string;
  message: string;
  retryable: boolean;
  status?: number;
}

interface PypiProxyRebuildCache {
  upstreamUrl: string;
  rootUrl: string;
  indexedAt: string;
  projects: string[];
  failedProjects?: PypiProxyProjectFailure[];
}

async function readPypiProxyRebuild(
  objectStore: RepositoryObjectStore,
  repositoryName: string,
): Promise<PypiProxyRebuildCache | undefined> {
  const stored = await objectStore.getObject(proxyRebuildCacheKey(repositoryName));
  if (!stored) {
    return undefined;
  }
  const raw = JSON.parse(new TextDecoder().decode(await objectBytes(stored))) as Record<string, unknown>;
  if (
    typeof raw.upstreamUrl !== "string"
    || typeof raw.rootUrl !== "string"
    || typeof raw.indexedAt !== "string"
    || !Array.isArray(raw.projects)
  ) {
    return undefined;
  }
  return {
    upstreamUrl: raw.upstreamUrl,
    rootUrl: raw.rootUrl,
    indexedAt: raw.indexedAt,
    projects: raw.projects.filter((project): project is string => typeof project === "string"),
    failedProjects: Array.isArray(raw.failedProjects)
      ? raw.failedProjects.flatMap(parsePypiProxyProjectFailure)
      : [],
  };
}

function parsePypiProxyProjectFailure(value: unknown): PypiProxyProjectFailure[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const record = value as Record<string, unknown>;
  if (typeof record.project !== "string" || typeof record.message !== "string") {
    return [];
  }
  return [{
    project: record.project,
    message: record.message,
    retryable: record.retryable === true,
    ...(typeof record.status === "number" ? { status: record.status } : {}),
  }];
}

function proxyIndexResult(input: {
  phase: string;
  projectCount: number;
  warmedProjectCount: number;
  failedProjects: PypiProxyProjectFailure[];
  failedProjectSampleLimit: number;
}): Record<string, unknown> {
  return {
    phase: input.phase,
    projectCount: input.projectCount,
    warmedProjectCount: input.warmedProjectCount,
    failedProjectCount: input.failedProjects.length,
    failedProjects: input.failedProjects.slice(0, input.failedProjectSampleLimit),
  };
}

function pypiProxyProjectOffset(continuation: Record<string, unknown> | undefined): number | undefined {
  const offset = continuation?.projectOffset;
  return typeof offset === "number" && Number.isFinite(offset) && offset >= 0 ? Math.floor(offset) : undefined;
}

function pypiProxyProjectDetailOffset(continuation: Record<string, unknown> | undefined): number | undefined {
  const offset = continuation?.projectDetailOffset;
  return typeof offset === "number" && Number.isFinite(offset) && offset >= 0 ? Math.floor(offset) : undefined;
}

function uniqueNormalizedProjects(projects: string[]): string[] {
  return [...new Set(projects.map((project) => normalizeProjectName(project)).filter(Boolean))];
}

function proxyProjectArtifactRecord(input: {
  repositoryName: string;
  ecosystem: string;
  project: string;
  upstreamUrl: string;
  indexedAt: string;
  cacheStatus?: "pending" | "cached" | "failed";
  lastCacheFailure?: string;
}): RepositoryArtifactRecord {
  return {
    id: `artifact_${input.repositoryName}_pypi_proxy_project_${input.project}`,
    repositoryName: input.repositoryName,
    ecosystem: input.ecosystem,
    identity: `pypi:proxy-project:${input.project}`,
    family: `pypi:proxy-project:${input.project}`,
    name: input.project,
    summary: input.project,
    objectKeys: [],
    metadata: {
      source: "proxy",
      project: input.project,
      upstreamUrl: input.upstreamUrl,
      ...(input.cacheStatus ? { cacheStatus: input.cacheStatus } : {}),
      ...(input.lastCacheFailure ? { lastCacheFailure: input.lastCacheFailure } : {}),
    },
    publishedAt: input.indexedAt,
    updatedAt: input.indexedAt,
  };
}

async function removeStalePypiProxyProjectCache(input: {
  objectStore: RepositoryObjectStore;
  repositoryName: string;
  projects: Set<string>;
}): Promise<void> {
  const prefix = `repositories/${input.repositoryName}/_proxy-cache/pypi/projects/`;
  const objects = await listAllObjects(input.objectStore, prefix);
  for (const object of objects) {
    const encodedProject = /^(.+)\.json$/u.exec(object.key.slice(prefix.length))?.[1];
    if (!encodedProject) {
      continue;
    }
    const project = normalizeProjectName(decodeURIComponent(encodedProject));
    if (!input.projects.has(project)) {
      await input.objectStore.deleteObject(object.key);
    }
  }
}

function proxyCacheKey(repositoryName: string): string {
  return `repositories/${repositoryName}/_proxy-cache/pypi/projects.json`;
}

function proxyRebuildCacheKey(repositoryName: string): string {
  return `repositories/${repositoryName}/_proxy-cache/pypi/rebuild.json`;
}

function proxyProjectCacheKey(repositoryName: string, projectName: string): string {
  return `repositories/${repositoryName}/_proxy-cache/pypi/projects/${encodeURIComponent(projectName)}.json`;
}

async function updatePypiProxyProjectSummary(input: {
  objectStore: RepositoryObjectStore;
  repositoryName: string;
  project: string;
  fileCount: number;
}): Promise<void> {
  const stored = await input.objectStore.getObject(proxyCacheKey(input.repositoryName));
  if (!stored) {
    return;
  }
  const raw = JSON.parse(new TextDecoder().decode(await objectBytes(stored))) as Record<string, unknown>;
  const projects = Array.isArray(raw.projects) ? raw.projects : [];
  await input.objectStore.putJson(proxyCacheKey(input.repositoryName), {
    ...raw,
    projects: projects.map((project) => {
      if (!project || typeof project !== "object" || Array.isArray(project)) {
        return project;
      }
      const record = project as Record<string, unknown>;
      return record.name === input.project ? { ...record, fileCount: input.fileCount } : project;
    }),
  });
}

async function fetchPypiProxyProjects(
  fetchImpl: FetchLike,
  rootUrl: string,
  proxyPolicy: ProxyOperationalPolicy,
): Promise<string[]> {
  const rootResponse = await fetchWithTimeout(fetchImpl, new Request(rootUrl, {
    headers: { accept: "text/html" },
  }), proxyPolicy);
  if (!rootResponse.ok) {
    throw new ValidationError(`PyPI proxy upstream root returned ${rootResponse.status}`);
  }
  return parseProjectListHtml(await rootResponse.text());
}

async function fetchWithTimeout(fetchImpl: FetchLike, request: Request, proxyPolicy: ProxyOperationalPolicy): Promise<Response> {
  const maxAttempts = proxyPolicy.upstreamRequestRetries + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchOnceWithTimeout(fetchImpl, request, proxyPolicy.upstreamFetchTimeoutMs);
      if (!pypiProxyResponseStatusIsRetryable(response.status) || attempt >= maxAttempts) {
        return response;
      }
    } catch (error) {
      if (attempt >= maxAttempts) {
        throw error;
      }
    }
    await delay(pypiProxyRetryDelayMs(attempt, proxyPolicy));
  }
  throw new Error("PyPI proxy upstream retry loop ended unexpectedly");
}

async function fetchOnceWithTimeout(fetchImpl: FetchLike, request: Request, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error(`PyPI proxy upstream request timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  try {
    return await fetchImpl(new Request(request, { signal: controller.signal }));
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchAndCachePypiProxyProject(input: {
  fetch: FetchLike;
  objectStore: RepositoryObjectStore;
  artifactStore: RepositoryArtifactStore | undefined;
  repositoryName: string;
  repositoryEcosystem: string;
  repositoryConfig: Record<string, unknown>;
  proxyPolicy: ProxyOperationalPolicy;
  project: string;
  cachedProject?: { name: string; files: unknown[] };
}): Promise<{ name: string; files: unknown[] } | undefined> {
  const upstream = parsePypiProxyRepositoryConfig(input.repositoryConfig);
  const projectName = normalizeProjectName(input.project);
  if (input.cachedProject) {
    await upsertPypiProxyProjectArtifacts({
      artifactStore: input.artifactStore,
      repositoryName: input.repositoryName,
      repositoryEcosystem: input.repositoryEcosystem,
      repositoryConfig: input.repositoryConfig,
      project: projectName,
      files: input.cachedProject.files,
    });
    return input.cachedProject;
  }
  const projectUrl = pypiProxyUpstreamUrl(upstream.upstreamUrl, `${SIMPLE_PREFIX}/${projectName}/`);
  if (!projectUrl) {
    return undefined;
  }
  const project = await fetchAndStorePypiProxyProject({
    fetch: input.fetch,
      objectStore: input.objectStore,
      repositoryName: input.repositoryName,
      projectName,
      projectUrl,
      proxyPolicy: input.proxyPolicy,
  }).catch(() => undefined);
  if (!project) {
    return undefined;
  }
  await upsertPypiProxyProjectArtifacts({
    artifactStore: input.artifactStore,
    repositoryName: input.repositoryName,
    repositoryEcosystem: input.repositoryEcosystem,
    repositoryConfig: input.repositoryConfig,
    project: projectName,
    files: project.files,
  });
  return project;
}

async function fetchAndCachePypiProxyProjectForWarming(input: {
  fetch: FetchLike;
  objectStore: RepositoryObjectStore;
  repositoryName: string;
  repositoryConfig: Record<string, unknown>;
  proxyPolicy: ProxyOperationalPolicy;
  project: string;
}): Promise<{ project?: { name: string; files: unknown[] }; failure?: PypiProxyProjectFailure }> {
  const upstream = parsePypiProxyRepositoryConfig(input.repositoryConfig);
  const projectName = normalizeProjectName(input.project);
  const projectUrl = pypiProxyUpstreamUrl(upstream.upstreamUrl, `${SIMPLE_PREFIX}/${projectName}/`);
  if (!projectUrl) {
    return {
      failure: {
        project: projectName,
        message: `PyPI proxy upstream project ${projectName} could not be resolved`,
        retryable: false,
      },
    };
  }
  try {
    return {
      project: await fetchAndStorePypiProxyProject({
        fetch: input.fetch,
        objectStore: input.objectStore,
        repositoryName: input.repositoryName,
        projectName,
        projectUrl,
        proxyPolicy: input.proxyPolicy,
      }),
    };
  } catch (error) {
    return {
      failure: pypiProxyProjectFailure(projectName, error),
    };
  }
}

async function fetchAndStorePypiProxyProject(input: {
  fetch: FetchLike;
  objectStore: RepositoryObjectStore;
  repositoryName: string;
  projectName: string;
  projectUrl: string;
  proxyPolicy: ProxyOperationalPolicy;
}): Promise<{ name: string; files: unknown[] }> {
  const projectResponse = await fetchWithTimeout(input.fetch, new Request(input.projectUrl, {
    headers: { accept: "text/html" },
  }), input.proxyPolicy).catch((error: unknown) => {
    throw new PypiProxyUpstreamError(
      `PyPI proxy upstream project ${input.projectName} request failed: ${error instanceof Error ? error.message : String(error)}`,
      true,
    );
  });
  if (!projectResponse.ok) {
    throw new PypiProxyUpstreamError(
      `PyPI proxy upstream project ${input.projectName} returned ${projectResponse.status}`,
      projectResponse.status === 429 || projectResponse.status >= 500,
      projectResponse.status,
    );
  }
  const files = parseProjectFilesHtml(await projectResponse.text(), { includeUrl: true });
  const project = { name: input.projectName, files };
  await input.objectStore.putJson(proxyProjectCacheKey(input.repositoryName, input.projectName), project);
  await updatePypiProxyProjectSummary({
    objectStore: input.objectStore,
    repositoryName: input.repositoryName,
    project: input.projectName,
    fileCount: files.length,
  });
  return project;
}

function pypiProxyResponseStatusIsRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

function pypiProxyRetryDelayMs(attempt: number, proxyPolicy: ProxyOperationalPolicy): number {
  return Math.min(
    proxyPolicy.upstreamRetryBaseDelayMs * 2 ** Math.max(0, attempt - 1),
    proxyPolicy.upstreamRetryMaxDelayMs,
  );
}

function delay(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

class PypiProxyUpstreamError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
  }
}

function pypiProxyProjectFailure(project: string, error: unknown): PypiProxyProjectFailure {
  if (error instanceof PypiProxyUpstreamError) {
    return {
      project,
      message: error.message,
      retryable: error.retryable,
      ...(error.status !== undefined ? { status: error.status } : {}),
    };
  }
  return {
    project,
    message: error instanceof Error ? error.message : String(error),
    retryable: true,
  };
}

async function upsertPypiProxyProjectArtifacts(input: {
  artifactStore: RepositoryArtifactStore | undefined;
  repositoryName: string;
  repositoryEcosystem: string;
  repositoryConfig: Record<string, unknown>;
  project: string;
  files: unknown[];
}): Promise<void> {
  if (!input.artifactStore) {
    return;
  }
  const upstream = parsePypiProxyRepositoryConfig(input.repositoryConfig);
  const projectUrl = pypiProxyUpstreamUrl(upstream.upstreamUrl, `${SIMPLE_PREFIX}/${input.project}/`);
  if (!projectUrl) {
    return;
  }
  for (const artifact of pypiProxyProjectArtifacts(input)) {
    await input.artifactStore.upsert(artifact);
  }
}

function pypiProxyProjectArtifacts(input: {
  repositoryName: string;
  repositoryEcosystem: string;
  repositoryConfig: Record<string, unknown>;
  indexedAt?: string;
  project: string;
  files: unknown[];
}): RepositoryArtifactRecord[] {
  const upstream = parsePypiProxyRepositoryConfig(input.repositoryConfig);
  const projectUrl = pypiProxyUpstreamUrl(upstream.upstreamUrl, `${SIMPLE_PREFIX}/${input.project}/`);
  if (!projectUrl) {
    return [];
  }
  const indexedAt = input.indexedAt ?? new Date().toISOString();
  return proxyProjectFiles(input.files).flatMap((file) => {
    const distribution = parseDistributionFilename(file.filename);
    if (!distribution) {
      return [];
    }
    const objectKey = proxyProjectFileObjectKey(file, projectUrl);
    return [{
      id: `artifact_${input.repositoryName}_pypi_proxy_file_${input.project}_${file.filename}`,
      repositoryName: input.repositoryName,
      ecosystem: input.repositoryEcosystem,
      identity: `pypi:proxy-file:${input.project}:${file.filename}`,
      family: `pypi:proxy-project:${input.project}`,
      name: input.project,
      version: distribution.version,
      summary: `${input.project} ${distribution.version}`,
      primaryObjectKey: objectKey,
      objectKeys: [objectKey],
      metadata: {
        source: "proxy",
        project: input.project,
        filename: file.filename,
        version: distribution.version,
        upstreamUrl: objectKey,
        ...(file.sha256 ? { sha256: file.sha256 } : {}),
        ...(file.requiresPython ? { requiresPython: file.requiresPython } : {}),
        ...(file.coreMetadataSha256 ? { coreMetadataSha256: file.coreMetadataSha256 } : {}),
        ...(file.yanked === undefined ? {} : { yanked: file.yanked }),
      },
      publishedAt: indexedAt,
      updatedAt: indexedAt,
    }];
  });
}

function proxyProjectFileObjectKey(file: { filename: string; url?: string }, projectUrl: string): string {
  return file.url ? new URL(file.url, projectUrl).toString() : new URL(file.filename, projectUrl).toString();
}

interface PypiProxyFileCacheMetadata {
  upstreamUrl: string;
  contentType: string;
  contentLength: number;
  cachedAt: string;
  etag?: string;
  lastModified?: string;
  acceptRanges?: string;
  cacheControl?: string;
}

async function pypiProxyFileCacheObjectKey(repositoryName: string, upstreamUrl: string): Promise<string> {
  const digest = await digestHex("SHA-256", new TextEncoder().encode(upstreamUrl));
  return `repositories/${repositoryName}/_proxy-cache/pypi/files/${digest}`;
}

async function pypiProxyFileCacheMetadataKey(repositoryName: string, upstreamUrl: string): Promise<string> {
  return `${await pypiProxyFileCacheObjectKey(repositoryName, upstreamUrl)}.json`;
}

function pypiProxyFileCacheLeaseKey(repositoryName: string, upstreamUrl: string): string {
  return `${repositoryName}\0${upstreamUrl}`;
}

function pypiProxyByteCachePrefix(repositoryName: string): string {
  return `repositories/${repositoryName}/_proxy-cache/pypi/files/`;
}

async function readPypiProxyFileCache(input: {
  objectStore: RepositoryObjectStore;
  repositoryName: string;
  upstreamUrl: string;
  method: string;
  policy: ProxyFileByteCachePolicy;
}): Promise<Response | null> {
  const objectKey = await pypiProxyFileCacheObjectKey(input.repositoryName, input.upstreamUrl);
  const object = await input.objectStore.getObject(objectKey);
  if (!object) {
    return null;
  }
  const metadata = await readPypiProxyFileCacheMetadata({
    objectStore: input.objectStore,
    repositoryName: input.repositoryName,
    upstreamUrl: input.upstreamUrl,
  });
  if (pypiProxyFileCacheIsExpired(metadata, input.policy)) {
    await input.objectStore.deleteObjects([
      objectKey,
      await pypiProxyFileCacheMetadataKey(input.repositoryName, input.upstreamUrl),
    ]);
    return null;
  }
  const headers = pypiProxyFileCacheHeaders(metadata, object);
  return new Response(input.method === "HEAD" ? null : objectStream(object), {
    status: 200,
    headers,
  });
}

async function streamAndCachePypiProxyFileResponse(input: {
  objectStore: RepositoryObjectStore;
  repositoryName: string;
  upstreamUrl: string;
  response: Response;
  fileCacheWrites: Map<string, Promise<void>>;
  policy: ProxyFileByteCachePolicy;
  scheduleBackgroundTask?: (task: Promise<unknown>) => void;
}): Promise<Response> {
  if (!input.response.body || !input.scheduleBackgroundTask) {
    return cachePypiProxyFileResponse({
      objectStore: input.objectStore,
      repositoryName: input.repositoryName,
      upstreamUrl: input.upstreamUrl,
      response: input.response,
      policy: input.policy,
    });
  }
  const [clientBody, cacheBody] = input.response.body.tee();
  const cacheResponse = new Response(cacheBody, {
    status: input.response.status,
    statusText: input.response.statusText,
    headers: input.response.headers,
  });
  const leaseKey = pypiProxyFileCacheLeaseKey(input.repositoryName, input.upstreamUrl);
  const task = cachePypiProxyFileResponse({
    objectStore: input.objectStore,
    repositoryName: input.repositoryName,
    upstreamUrl: input.upstreamUrl,
    response: cacheResponse,
    policy: input.policy,
  })
    .then(() => undefined)
    .catch((error) => {
      console.error(`PyPI proxy file cache write failed: ${error instanceof Error ? error.message : String(error)}`);
    })
    .finally(() => {
      input.fileCacheWrites.delete(leaseKey);
    });
  input.fileCacheWrites.set(leaseKey, task);
  input.scheduleBackgroundTask(task);
  return new Response(clientBody, {
    status: input.response.status,
    statusText: input.response.statusText,
    headers: proxyResponseHeaders(input.response.headers),
  });
}

async function cachePypiProxyFileResponse(input: {
  objectStore: RepositoryObjectStore;
  repositoryName: string;
  upstreamUrl: string;
  response: Response;
  policy: ProxyFileByteCachePolicy;
}): Promise<Response> {
  const contentType = input.response.headers.get("content-type") ?? "application/octet-stream";
  const objectKey = await pypiProxyFileCacheObjectKey(input.repositoryName, input.upstreamUrl);
  const writer = await input.objectStore.createPartWriter(objectKey, contentType);
  try {
    if (input.response.body) {
      await writeReadableStreamToPartWriter(input.response.body, writer);
    }
    const { size } = await writer.complete();
    const metadata: PypiProxyFileCacheMetadata = {
      upstreamUrl: input.upstreamUrl,
      contentType,
      contentLength: size,
      cachedAt: new Date().toISOString(),
      ...(input.response.headers.get("etag") ? { etag: input.response.headers.get("etag")! } : {}),
      ...(input.response.headers.get("last-modified") ? { lastModified: input.response.headers.get("last-modified")! } : {}),
      ...(input.response.headers.get("accept-ranges") ? { acceptRanges: input.response.headers.get("accept-ranges")! } : {}),
      ...(input.response.headers.get("cache-control") ? { cacheControl: input.response.headers.get("cache-control")! } : {}),
    };
    await input.objectStore.putJson(
      await pypiProxyFileCacheMetadataKey(input.repositoryName, input.upstreamUrl),
      metadata,
    );
    await enforcePypiProxyFileCacheBudget(input.objectStore, input.repositoryName, input.policy);
    const cached = await readPypiProxyFileCache({
      objectStore: input.objectStore,
      repositoryName: input.repositoryName,
      upstreamUrl: input.upstreamUrl,
      method: "GET",
      policy: input.policy,
    });
    if (cached) {
      return cached;
    }
    return new Response(null, {
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

async function readPypiProxyFileCacheMetadata(input: {
  objectStore: RepositoryObjectStore;
  repositoryName: string;
  upstreamUrl: string;
}): Promise<PypiProxyFileCacheMetadata | null> {
  const object = await input.objectStore.getObject(
    await pypiProxyFileCacheMetadataKey(input.repositoryName, input.upstreamUrl),
  );
  if (!object) {
    return null;
  }
  const metadata = parsePypiProxyFileCacheMetadataObject(new TextDecoder().decode(await objectBytes(object)));
  if (metadata.upstreamUrl !== input.upstreamUrl) {
    return null;
  }
  return metadata;
}

function parsePypiProxyFileCacheMetadataObject(value: string | Record<string, unknown>): PypiProxyFileCacheMetadata {
  const parsed = typeof value === "string" ? parseJsonObject(value) : value;
  const contentType = typeof parsed.contentType === "string" ? parsed.contentType : "application/octet-stream";
  const contentLength = typeof parsed.contentLength === "number" ? parsed.contentLength : 0;
  return {
    upstreamUrl: typeof parsed.upstreamUrl === "string" ? parsed.upstreamUrl : "",
    contentType,
    contentLength,
    cachedAt: typeof parsed.cachedAt === "string" ? parsed.cachedAt : "",
    ...(typeof parsed.etag === "string" ? { etag: parsed.etag } : {}),
    ...(typeof parsed.lastModified === "string" ? { lastModified: parsed.lastModified } : {}),
    ...(typeof parsed.acceptRanges === "string" ? { acceptRanges: parsed.acceptRanges } : {}),
    ...(typeof parsed.cacheControl === "string" ? { cacheControl: parsed.cacheControl } : {}),
  };
}

function pypiProxyFileCacheHeaders(
  metadata: PypiProxyFileCacheMetadata | null,
  object: { contentType?: string; contentLength?: number; etag?: string },
): Headers {
  const headers = new Headers();
  const contentType = metadata?.contentType ?? object.contentType;
  if (contentType) {
    headers.set("content-type", contentType);
  }
  const contentLength = metadata?.contentLength ?? object.contentLength;
  if (contentLength !== undefined) {
    headers.set("content-length", String(contentLength));
  }
  const etag = metadata?.etag ?? object.etag;
  if (etag) {
    headers.set("etag", etag);
  }
  if (metadata?.lastModified) {
    headers.set("last-modified", metadata.lastModified);
  }
  if (metadata?.acceptRanges) {
    headers.set("accept-ranges", metadata.acceptRanges);
  }
  if (metadata?.cacheControl) {
    headers.set("cache-control", metadata.cacheControl);
  }
  return headers;
}

function pypiProxyFileCacheIsExpired(
  metadata: PypiProxyFileCacheMetadata | null,
  policy: ProxyFileByteCachePolicy,
): boolean {
  if (policy.ttlSeconds <= 0 || !metadata?.cachedAt) {
    return false;
  }
  const cachedAt = new Date(metadata.cachedAt).getTime();
  if (!Number.isFinite(cachedAt)) {
    return true;
  }
  return Date.now() - cachedAt > policy.ttlSeconds * 1000;
}

async function enforcePypiProxyFileCacheBudget(
  objectStore: RepositoryObjectStore,
  repositoryName: string,
  policy: ProxyFileByteCachePolicy,
): Promise<void> {
  if (policy.maxTotalBytes <= 0) {
    return;
  }
  const listing = await listAllObjects(objectStore, pypiProxyByteCachePrefix(repositoryName));
  const files = await Promise.all(listing
    .filter((object) => !object.key.endsWith(".json"))
    .map(async (object) => {
      const metadataObject = await objectStore.getObject(`${object.key}.json`);
      const metadata = metadataObject
        ? parsePypiProxyFileCacheMetadataObject(new TextDecoder().decode(await objectBytes(metadataObject)))
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

function hasPypiProxyConditionalRequestHeaders(headers: Headers): boolean {
  return headers.has("if-none-match")
    || headers.has("if-modified-since")
    || headers.has("if-match")
    || headers.has("if-unmodified-since");
}

function pypiProxyFileResponseCanBeCached(headers: Headers, policy: ProxyFileByteCachePolicy): boolean {
  const contentLength = parsePypiProxyFileCacheContentLength(headers.get("content-length"));
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

function parsePypiProxyFileCacheContentLength(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

async function cachePypiProxyProjectResponse(input: {
  objectStore: RepositoryObjectStore | undefined;
  repositoryName: string;
  relativePath: string;
  response: Response;
}): Promise<void> {
  if (!input.objectStore) {
    return;
  }
  const projectName = pypiProxyProjectFromRelativePath(input.relativePath);
  if (!projectName) {
    return;
  }
  const contentType = input.response.headers.get("content-type")?.toLowerCase() ?? "";
  const text = await input.response.clone().text();
  const files = contentType.includes(SIMPLE_JSON_CONTENT_TYPE)
    ? parsePypiProxyProjectFilesJson(text)
    : parseProjectFilesHtml(text, { includeUrl: true });
  if (files.length === 0) {
    return;
  }
  await input.objectStore.putJson(proxyProjectCacheKey(input.repositoryName, projectName), {
    name: projectName,
    files,
  });
  await updatePypiProxyProjectSummary({
    objectStore: input.objectStore,
    repositoryName: input.repositoryName,
    project: projectName,
    fileCount: files.length,
  });
}

function parsePypiProxyProjectFilesJson(text: string): SimpleProjectFile[] {
  const parsed = parseJsonObject(text);
  const files = Array.isArray(parsed.files) ? parsed.files : [];
  return files.flatMap((file): SimpleProjectFile[] => {
    if (!isRecord(file) || typeof file.filename !== "string" || typeof file.url !== "string") {
      return [];
    }
    const hashes = isRecord(file.hashes) ? file.hashes : {};
    const sha256 = typeof hashes.sha256 === "string" ? hashes.sha256 : undefined;
    if (!sha256) {
      return [];
    }
    const requiresPython = file["requires-python"];
    const coreMetadata = file["core-metadata"];
    const yanked = file.yanked;
    return [{
      filename: file.filename,
      url: file.url,
      sha256,
      ...(typeof requiresPython === "string" ? { requiresPython } : {}),
      ...(isRecord(coreMetadata) && typeof coreMetadata.sha256 === "string"
        ? { coreMetadataSha256: coreMetadata.sha256 }
        : {}),
      ...(yanked === undefined ? {} : { yanked: yanked === true ? "" : String(yanked) }),
    }];
  });
}

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pypiProxyProjectFromRelativePath(relativePath: string): string | undefined {
  const project = /^simple\/([^/]+)\/?$/u.exec(relativePath)?.[1];
  return project ? normalizeProjectName(project) : undefined;
}

export function pypiProxyUpstreamUrl(upstreamBaseUrl: string, relativePath: string): string | null {
  const path = relativePath.replace(/^\/+|\/+$/g, "");
  const simpleRoot = pypiProxySimpleRootUrl(upstreamBaseUrl);
  if (path === SIMPLE_PREFIX) {
    return simpleRoot;
  }
  const project = /^simple\/([^/]+)$/.exec(path)?.[1];
  if (!project) {
    return null;
  }
  return new URL(`${project}/`, simpleRoot).toString();
}

function pypiProxySimpleRootUrl(upstreamBaseUrl: string): string {
  const upstream = new URL(upstreamBaseUrl);
  const pathname = upstream.pathname.replace(/\/+$/g, "");
  if (pathname.endsWith(`/${SIMPLE_PREFIX}`)) {
    return ensureTrailingSlash(upstream.toString());
  }
  if (pathname === "" && upstream.hostname !== "pypi.org") {
    return ensureTrailingSlash(upstream.toString());
  }
  return new URL(`${SIMPLE_PREFIX}/`, upstream).toString();
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function proxyResponseHeaders(upstreamHeaders: Headers): Headers {
  const headers = new Headers(upstreamHeaders);
  for (const name of ["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]) {
    headers.delete(name);
  }
  return headers;
}

export function createPypiGroupPlugin(): GroupRepositoryPlugin {
  return {
    kind: "group",
    ecosystem: "pypi",
    name: `${pypiPluginManifest.runtimeName}-group`,
    version: pypiPluginManifest.version,
    repositoryKinds: ["group"],
    capabilities: ["pypi", "group"],
    canServeRepositoryPath: () => false,
    validateRepositoryConfig: ({ config }) => validatePypiRepositoryConfig(config),
  };
}

/**
 * Rejects anything that is not a distribution pip could install.
 *
 * The filename is what decides which project page a file is listed on, so a
 * name that cannot be parsed has no page to go on, and one that normalizes to
 * an unusable path segment would produce a page nothing can address.
 */
function validatePypiArtifacts(input: ValidatePublishArtifactsInput): void {
  inValidationErrorsSync(() => {
    for (const artifact of input.artifacts) {
      requireDistributionFilename(artifact.filename);
    }
  });
}

function artifactRecord(input: {
  repositoryName: string;
  ecosystem: string;
  filename: string;
  normalizedName: string;
  version: string;
  objectKey: string;
  publishedAt: string;
  updatedAt: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}): RepositoryArtifactRecord {
  return {
    // Identity is the stored path, so the same file described by a publish and
    // by a rebuild is one artifact rather than two.
    id: `artifact_${input.repositoryName}_pypi_${input.normalizedName}_${input.filename}`,
    repositoryName: input.repositoryName,
    ecosystem: input.ecosystem,
    identity: `pypi:${input.normalizedName}:${input.filename}`,
    // The project, not the file: a wheel and a source distribution of one
    // release are the same thing, and so are two releases of it.
    family: `pypi:${input.normalizedName}`,
    name: input.normalizedName,
    summary: `${input.normalizedName} ${input.version}`,
    primaryObjectKey: input.objectKey,
    // The core metadata published beside the distribution belongs to it, and
    // is listed here so that deleting the artifact takes it too. A file with
    // no artifact left to belong to would be served forever with nothing
    // pointing at it and nothing to clean it up.
    objectKeys: [input.objectKey, coreMetadataKey(input.objectKey)],
    metadata: {
      ...input.metadata,
      project: input.normalizedName,
      version: input.version,
      filename: input.filename,
    },
    publishedAt: input.publishedAt,
    updatedAt: input.updatedAt,
    ...(input.sessionId ? { publishSessionId: input.sessionId } : {}),
  };
}

function describePypiArtifacts(input: DescribePublishedArtifactsInput): RepositoryArtifactRecord[] {
  return input.session.artifacts.flatMap((artifact) => {
    const distribution = parseDistributionFilename(artifact.filename);
    if (!distribution) {
      return [];
    }
    const relativePath = packageRelativePath(distribution, artifact.filename);
    const objectKey = input.result.objects
      .map((object) => object.key)
      .find((key) => key.endsWith(`/${relativePath}`));
    if (!objectKey) {
      return [];
    }
    return [artifactRecord({
      repositoryName: input.repository.name,
      ecosystem: input.repository.ecosystem,
      filename: artifact.filename,
      normalizedName: distribution.normalizedName,
      version: distribution.version,
      objectKey,
      publishedAt: input.result.publishedAt,
      updatedAt: input.result.publishedAt,
      sessionId: input.session.id,
      metadata: { ...artifact.metadata },
    })];
  });
}

/**
 * Rebuilds the artifact index and the Simple index from the files held.
 *
 * The stored distributions are the repository's own record of itself, so a
 * rebuild reads those rather than any bookkeeping written alongside them: a
 * repository whose bookkeeping is lost or wrong can still be repaired.
 *
 * The Simple index is rewritten as part of that, because it is bookkeeping
 * too. This runs after an artifact is deleted, and a page that still lists a
 * file nobody can fetch is worse than no page: pip resolves against it and
 * fails on the download rather than choosing another release.
 *
 * A yank is the one thing not derivable from the files — nothing in a
 * distribution records it — so it is carried over from the page being
 * replaced. A rebuild repairs the index; it does not un-yank a release.
 */
async function rebuildPypiArtifactIndex(
  input: RebuildRepositoryArtifactIndexInput,
): Promise<RepositoryArtifactRecord[]> {
  const repositoryPrefix = `repositories/${input.repository.name}/`;
  const objects = await listAllObjects(input.objectStore, `${repositoryPrefix}${PACKAGES_PREFIX}/`);
  const artifacts: RepositoryArtifactRecord[] = [];
  const byProject = new Map<string, StoredDistribution[]>();

  for (const object of objects) {
    const stored = parsePackageRelativePath(object.key.slice(repositoryPrefix.length));
    if (!stored) {
      continue;
    }
    const distribution = parseDistributionFilename(stored.filename);
    // A file whose name does not parse cannot be listed on any project page,
    // so it is not something this repository publishes. The core metadata
    // stored beside each distribution lands here too, and is skipped the same
    // way: it belongs to a distribution rather than standing on its own.
    if (!distribution || distribution.normalizedName !== stored.normalizedName) {
      continue;
    }
    artifacts.push(artifactRecord({
      repositoryName: input.repository.name,
      ecosystem: input.repository.ecosystem,
      filename: stored.filename,
      normalizedName: distribution.normalizedName,
      version: distribution.version,
      objectKey: object.key,
      publishedAt: input.now.toISOString(),
      updatedAt: input.now.toISOString(),
    }));
    byProject.set(
      distribution.normalizedName,
      [
        ...(byProject.get(distribution.normalizedName) ?? []),
        { filename: stored.filename, objectKey: object.key, distribution },
      ],
    );
  }

  await writeSimpleIndexes({
    objectStore: input.objectStore,
    repositoryName: input.repository.name,
    projects: await Promise.all([...byProject].map(async ([project, stored]) => ({
      project,
      files: await rebuiltProjectFiles({
        objectStore: input.objectStore,
        repositoryName: input.repository.name,
        project,
        stored,
      }),
    }))),
  });
  await removeEmptyProjectPages({
    objectStore: input.objectStore,
    repositoryName: input.repository.name,
    projects: new Set(byProject.keys()),
  });

  return artifacts;
}

/** A distribution found in the packages tree, with what it took to find it. */
interface StoredDistribution {
  filename: string;
  objectKey: string;
  distribution: PypiDistributionFilename;
}

/** Re-derives a project's page entries from the distributions it still holds. */
async function rebuiltProjectFiles(input: {
  objectStore: RepositoryObjectStore;
  repositoryName: string;
  project: string;
  stored: StoredDistribution[];
}): Promise<SimpleProjectFile[]> {
  const published = new Map(
    (await readPublishedProjectFiles({
      objectStore: input.objectStore,
      repositoryName: input.repositoryName,
      project: input.project,
    })).map((file) => [file.filename, file] as const),
  );

  return Promise.all(input.stored.map(async (stored) => {
    const previous = published.get(stored.filename);
    const metadata = await readOrRestoreCoreMetadata({
      objectStore: input.objectStore,
      key: stored.objectKey,
      distribution: stored.distribution,
    });
    return {
      filename: stored.filename,
      sha256: await digestObject(input.objectStore, stored.objectKey),
      ...(metadata.requiresPython ? { requiresPython: metadata.requiresPython } : {}),
      coreMetadataSha256: await digestHex("SHA-256", new TextEncoder().encode(metadata.text)),
      // Not something a distribution records, so it survives only by being
      // carried across.
      ...(previous?.yanked === undefined ? {} : { yanked: previous.yanked }),
    } satisfies SimpleProjectFile;
  }));
}

/**
 * Reads the core metadata beside a distribution, republishing it if it is gone.
 *
 * The side file is what PEP 658 serves and what the page's digest describes,
 * so a rebuild that found it missing and carried on would leave the page
 * pointing at nothing. It is cheap to read back out of the distribution.
 */
async function readOrRestoreCoreMetadata(input: {
  objectStore: RepositoryObjectStore;
  key: string;
  distribution: PypiDistributionFilename;
}): Promise<PypiCoreMetadata> {
  const stored = await input.objectStore.getObject(coreMetadataKey(input.key));
  if (stored) {
    return parseCoreMetadata(new TextDecoder().decode(await objectBytes(stored)));
  }

  const metadata = await readDistributionMetadata(input);
  await input.objectStore.putText(
    coreMetadataKey(input.key),
    metadata.text,
    CORE_METADATA_CONTENT_TYPE,
  );
  return metadata;
}

async function digestObject(
  objectStore: RepositoryObjectStore,
  key: string,
): Promise<string> {
  const object = await objectStore.getObject(key);
  if (!object) {
    throw new ValidationError(`PyPI distribution disappeared while being read: ${key}`);
  }
  return digestStreamHex("SHA-256", objectStream(object));
}

/**
 * Drops the pages of projects whose last distribution is gone.
 *
 * The root index is generated from the packages tree and stops listing them on
 * its own, but pip is given a project URL and asks for it directly, so a page
 * left behind stays reachable and keeps offering files that are not there.
 */
async function removeEmptyProjectPages(input: {
  objectStore: RepositoryObjectStore;
  repositoryName: string;
  projects: Set<string>;
}): Promise<void> {
  const prefix = `repositories/${input.repositoryName}/${SIMPLE_PREFIX}/`;
  const objects = await listAllObjects(input.objectStore, prefix);

  for (const object of objects) {
    const [project, ...rest] = object.key.slice(prefix.length).split("/");
    // The root index lives directly under the prefix and is not a project.
    if (rest.length === 0 || !project || input.projects.has(project)) {
      continue;
    }
    await input.objectStore.deleteObject(object.key);
  }
}
