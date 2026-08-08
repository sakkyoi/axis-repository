import type { RepositoryArtifactRecord, RepositoryArtifactStore, RepositoryObjectStore } from "@axis-repository/core";
import { ValidationError } from "@axis-repository/core";
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
import {
  parseDistributionFilename,
  normalizeProjectName,
  requireDistributionFilename,
  type PypiDistributionFilename,
} from "../shared/names";
import type { SimpleProjectFile } from "./simple-index";
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
const PYPI_PROXY_UPSTREAM_FETCH_TIMEOUT_MS = 2000;
const PYPI_PROXY_PROJECT_MARKER_BATCH_SIZE = 100;

export function createPypiProxyPlugin(input: {
  fetch?: FetchLike;
  objectStoreFor?: (repositoryName: string) => RepositoryObjectStore;
} = {}): ProxyRepositoryPlugin {
  const fetchImpl = input.fetch ?? ((request: Request) => fetch(request));
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
          fetchProxyProject: ({ repositoryName, repositoryEcosystem, repositoryConfig, artifactStore, project, cachedProject }) =>
            fetchAndCachePypiProxyProject({
              fetch: fetchImpl,
              objectStore: input.objectStoreFor!(repositoryName),
              artifactStore,
              repositoryName,
              repositoryEcosystem,
              repositoryConfig,
              project,
              ...(cachedProject === undefined ? {} : { cachedProject }),
            }),
        }),
      }
      : {}),
    objectBrowser: createPypiProxyObjectBrowser(fetchImpl),
    artifacts: {
      rebuildIndex: (rebuildInput) => rebuildPypiProxyArtifactIndex({
        ...rebuildInput,
        fetch: fetchImpl,
      }),
    },
    serveRepositoryPath: async ({ repository, request, relativePath }) => {
      const upstream = parsePypiProxyRepositoryConfig(repository.config);
      const upstreamUrl = await pypiProxyServeUpstreamUrl({
        objectStore: input.objectStoreFor?.(repository.name),
        repositoryName: repository.name,
        upstreamUrl: upstream.upstreamUrl,
        relativePath,
      });
      if (!upstreamUrl) {
        return null;
      }
      const headers = new Headers();
      const accept = request.headers.get("accept");
      if (accept) {
        headers.set("accept", accept);
      }
      const upstreamResponse = await fetchImpl(new Request(upstreamUrl, {
        method: request.method,
        headers,
      }));
      if (request.method === "GET" && upstreamResponse.ok) {
        await cachePypiProxyProjectResponse({
          objectStore: input.objectStoreFor?.(repository.name),
          repositoryName: repository.name,
          relativePath,
          response: upstreamResponse,
        });
      }
      return new Response(request.method === "HEAD" ? null : upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: proxyResponseHeaders(upstreamResponse.headers),
      });
    },
    validateRepositoryConfig: ({ config }) => {
      parsePypiProxyRepositoryConfig(config);
    },
  };
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
      offset: detailOffset,
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
    offset: continuationOffset ?? 0,
  });
}

async function startPypiProxyRebuild(input: {
  fetch: FetchLike;
  objectStore: RepositoryObjectStore;
  repositoryName: string;
  upstreamUrl: string;
  rootUrl: string;
  indexedAt: string;
}): Promise<PypiProxyRebuildCache> {
  const projects = await fetchPypiProxyProjects(input.fetch, input.rootUrl);
  const normalizedProjects = uniqueNormalizedProjects(projects);
  const rebuild: PypiProxyRebuildCache = {
    upstreamUrl: input.upstreamUrl,
    rootUrl: input.rootUrl,
    indexedAt: input.indexedAt,
    projects: normalizedProjects,
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
  offset: number;
}) {
  const start = Math.max(0, input.offset);
  const end = Math.min(start + PYPI_PROXY_PROJECT_MARKER_BATCH_SIZE, input.projects.length);
  const markerComplete = end >= input.projects.length;
  return {
    artifacts: input.projects.slice(start, end).map((project) => proxyProjectArtifactRecord({
      repositoryName: input.repositoryName,
      ecosystem: input.repositoryEcosystem,
      project,
      upstreamUrl: pypiProxyUpstreamUrl(input.upstreamUrl, `${SIMPLE_PREFIX}/${project}/`) ?? input.rootUrl,
      indexedAt: input.indexedAt,
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
  offset: number;
}) {
  const start = Math.max(0, input.offset);
  const end = Math.min(start + 1, input.projects.length);
  const artifacts: RepositoryArtifactRecord[] = [];
  for (const project of input.projects.slice(start, end)) {
    const cachedProject = await fetchAndCachePypiProxyProject({
      fetch: input.fetch,
      objectStore: input.objectStore,
      artifactStore: undefined,
      repositoryName: input.repositoryName,
      repositoryEcosystem: input.repositoryEcosystem,
      repositoryConfig: input.repositoryConfig,
      project,
    });
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
  }
  return {
    artifacts,
    complete,
    ...(complete ? {} : { continuation: { projectDetailOffset: end } }),
    progress: {
      current: input.projects.length + end,
      total: input.projects.length * 2,
      message: `Warmed project details ${end} of ${input.projects.length}`,
    },
  };
}

interface PypiProxyRebuildCache {
  upstreamUrl: string;
  rootUrl: string;
  indexedAt: string;
  projects: string[];
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

async function fetchPypiProxyProjects(fetchImpl: FetchLike, rootUrl: string): Promise<string[]> {
  const rootResponse = await fetchWithTimeout(fetchImpl, new Request(rootUrl, {
    headers: { accept: "text/html" },
  }));
  if (!rootResponse.ok) {
    throw new ValidationError(`PyPI proxy upstream root returned ${rootResponse.status}`);
  }
  return parseProjectListHtml(await rootResponse.text());
}

async function fetchWithTimeout(fetchImpl: FetchLike, request: Request): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error(`PyPI proxy upstream request timed out after ${PYPI_PROXY_UPSTREAM_FETCH_TIMEOUT_MS}ms`));
  }, PYPI_PROXY_UPSTREAM_FETCH_TIMEOUT_MS);
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
  const projectResponse = await fetchWithTimeout(input.fetch, new Request(projectUrl, {
    headers: { accept: "text/html" },
  })).catch(() => undefined);
  if (!projectResponse?.ok) {
    return undefined;
  }
  const files = parseProjectFilesHtml(await projectResponse.text(), { includeUrl: true });
  const project = { name: projectName, files };
  await input.objectStore.putJson(proxyProjectCacheKey(input.repositoryName, projectName), project);
  await updatePypiProxyProjectSummary({
    objectStore: input.objectStore,
    repositoryName: input.repositoryName,
    project: projectName,
    fileCount: files.length,
  });
  await upsertPypiProxyProjectArtifacts({
    artifactStore: input.artifactStore,
    repositoryName: input.repositoryName,
    repositoryEcosystem: input.repositoryEcosystem,
    repositoryConfig: input.repositoryConfig,
    project: projectName,
    files,
  });
  return project;
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
  const files = parseProjectFilesHtml(await input.response.clone().text(), { includeUrl: true });
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
