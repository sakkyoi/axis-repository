import {
  NotFoundError,
  ValidationError,
  type Repository,
  type RepositoryArtifactStore,
  type RepositoryObjectStore,
} from "@axis-repository/core";
import type { RepositoryAdminResources } from "@axis-repository/runtime-cloudflare/plugin-runtime";
import { listAllObjects, objectBytes, pluginJsonResponse, readJsonObject } from "@axis-repository/runtime-cloudflare/plugin-runtime";
import { pypiPluginManifest } from "../manifest";
import { listProjects, readPublishedProjectFiles, writeSimpleIndexes } from "./index-store";
import { normalizeProjectName } from "../shared/names";

const DEFAULT_PROJECT_PAGE_LIMIT = 50;
const MAX_PROJECT_PAGE_LIMIT = 100;

interface ProjectPageParams {
  limit: number;
  offset: number;
}

function pypiAdminResourceRoute(name: string) {
  const route = pypiPluginManifest.adminResources.routes.find((candidate) => candidate.name === name);
  if (!route) {
    throw new Error(`PyPI admin resource manifest is not configured: ${name}`);
  }
  return { ...route, path: [...route.path] };
}

interface PypiAdminResourceInput {
  objectStoreFor: (repositoryName: string) => RepositoryObjectStore;
}

interface PypiProxyAdminResourceInput extends PypiAdminResourceInput {
  fetchProxyProject?: (input: {
    repository: Repository;
    repositoryName: string;
    repositoryEcosystem: string;
    repositoryConfig: Record<string, unknown>;
    artifactStore: RepositoryArtifactStore | undefined;
    project: string;
    cachedProject?: { name: string; files: unknown[] };
  }) => Promise<{ name: string; files: unknown[] } | undefined>;
}

/**
 * Yanking, as PEP 592 defines it.
 *
 * A yanked file stays downloadable — anything that already pins it keeps
 * working — but a resolver passes over it unless nothing else satisfies the
 * requirement. That is what makes it the right answer for a broken release,
 * where deleting would break whoever already depends on it.
 */
export function createPypiHostedAdminResources(input: PypiAdminResourceInput): RepositoryAdminResources {
  async function setYanked(
    repositoryName: string,
    project: string,
    filename: string,
    yanked: string | undefined,
  ) {
    const objectStore = input.objectStoreFor(repositoryName);
    const normalized = normalizeProjectName(project);
    const files = await readPublishedProjectFiles({ objectStore, repositoryName, project: normalized });
    const target = files.find((file) => file.filename === filename);
    if (!target) {
      throw new NotFoundError();
    }

    const updated = files.map((file) => {
      if (file.filename !== filename) {
        return file;
      }
      const { yanked: _dropped, ...rest } = file;
      return yanked === undefined ? rest : { ...rest, yanked };
    });
    await writeSimpleIndexes({
      objectStore,
      repositoryName,
      projects: [{ project: normalized, files: updated }],
    });

    return { project: normalized, filename, yanked: yanked !== undefined, reason: yanked ?? null };
  }

  return {
    namespace: pypiPluginManifest.adminResources.namespace,
    routes: [
      {
        ...pypiAdminResourceRoute("list-projects"),
        handle: async ({ repositoryName, request }) => {
          const objectStore = input.objectStoreFor(repositoryName);
          const pageParams = projectPageParams(new URL(request.url).searchParams);
          // Read from the published pages rather than the artifact index, so
          // what an operator sees is what clients are being served, yank state
          // included.
          const projects = await listProjects(objectStore, repositoryName);
          return pluginJsonResponse({
            ...projectPage(projects
              .slice(pageParams.offset, pageParams.offset + pageParams.limit)
              .map((project) => ({ name: project })), projects.length, pageParams),
          });
        },
      },
      {
        ...pypiAdminResourceRoute("get-project"),
        handle: async ({ repositoryName, params }) => {
          const objectStore = input.objectStoreFor(repositoryName);
          const project = normalizeProjectName(requireParam(params.project));
          return pluginJsonResponse({
            project: {
              name: project,
              files: await readPublishedProjectFiles({ objectStore, repositoryName, project }),
            },
          });
        },
      },
      {
        ...pypiAdminResourceRoute("yank-file"),
        handle: async ({ repositoryName, params, request }) => {
          // A yank needs no body; a reason is optional.
          const body: Record<string, unknown> = await readJsonObject(request).catch(() => ({}));
          const reason = body.reason;
          if (reason !== undefined && typeof reason !== "string") {
            throw new ValidationError("reason must be a string");
          }
          return pluginJsonResponse(await setYanked(
            repositoryName,
            requireParam(params.project),
            requireParam(params.filename),
            // PEP 592 allows a yank with no stated reason, which is not the
            // same as not being yanked, so the empty string is meaningful.
            reason ?? "",
          ));
        },
      },
      {
        ...pypiAdminResourceRoute("unyank-file"),
        handle: async ({ repositoryName, params }) => {
          return pluginJsonResponse(await setYanked(
            repositoryName,
            requireParam(params.project),
            requireParam(params.filename),
            undefined,
          ));
        },
      },
    ],
  };
}

export function createPypiProxyAdminResources(input: PypiProxyAdminResourceInput): RepositoryAdminResources {
  return {
    namespace: pypiPluginManifest.adminResources.namespace,
    routes: [
      {
        ...pypiAdminResourceRoute("list-projects"),
        handle: async ({ repositoryName, request }) => {
          const objectStore = input.objectStoreFor(repositoryName);
          const pageParams = projectPageParams(new URL(request.url).searchParams);
          const projects = await readPypiProxyCachedProjectSummaries(objectStore, repositoryName);
          return pluginJsonResponse({
            ...projectPage(projects
              .slice(pageParams.offset, pageParams.offset + pageParams.limit)
              .map((project) => ({ name: project.name, fileCount: project.fileCount })), projects.length, pageParams),
          });
        },
      },
      {
        ...pypiAdminResourceRoute("get-project"),
        handle: async ({ repository, repositoryName, params, services }) => {
          if (!repository) {
            throw new NotFoundError();
          }
          const objectStore = input.objectStoreFor(repositoryName);
          const project = normalizeProjectName(requireParam(params.project));
          const cached = await readPypiProxyCachedProject(objectStore, repositoryName, project);
          const synced = await input.fetchProxyProject?.({
            repository,
            repositoryName,
            repositoryEcosystem: repository.ecosystem,
            repositoryConfig: repository.config,
            artifactStore: services.repositoryArtifactStore,
            project,
            ...(cached === undefined ? {} : { cachedProject: cached }),
          });
          if (!synced) {
            throw new NotFoundError();
          }
          return pluginJsonResponse({ project: synced });
        },
      },
      {
        name: "get-proxy-cache",
        method: "GET",
        path: ["proxy-cache"],
        responseKind: "json",
        handle: async ({ repositoryName }) => {
          const objectStore = input.objectStoreFor(repositoryName);
          return pluginJsonResponse({ cache: await pypiProxyByteCacheStats(objectStore, repositoryName) });
        },
      },
      {
        name: "purge-proxy-cache",
        method: "POST",
        path: ["proxy-cache", "purge"],
        responseKind: "json",
        handle: async () => {
          throw new ValidationError("PyPI proxy byte cache purge must be queued by the runtime");
        },
      },
    ],
  };
}

function projectPage<T>(projects: T[], total: number, params: ProjectPageParams) {
  const end = params.offset + params.limit;
  const truncated = end < total;
  return {
    projects,
    truncated,
    ...(truncated ? { cursor: encodeOffsetCursor(end) } : {}),
  };
}

function projectPageParams(searchParams: URLSearchParams): ProjectPageParams {
  const limitParam = searchParams.get("limit");
  const limit = limitParam === null ? DEFAULT_PROJECT_PAGE_LIMIT : Number(limitParam);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PROJECT_PAGE_LIMIT) {
    throw new ValidationError(`limit must be an integer between 1 and ${MAX_PROJECT_PAGE_LIMIT}`);
  }
  const cursor = searchParams.get("cursor");
  return {
    limit,
    offset: cursor ? decodeOffsetCursor(cursor) : 0,
  };
}

function encodeOffsetCursor(offset: number): string {
  return btoa(JSON.stringify({ offset }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function decodeOffsetCursor(cursor: string): number {
  try {
    const normalized = cursor.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    const parsed = JSON.parse(atob(padded)) as { offset?: unknown };
    const offset = parsed.offset;
    if (!Number.isSafeInteger(offset) || typeof offset !== "number" || offset < 0) {
      throw new Error("invalid offset");
    }
    return offset;
  } catch {
    throw new ValidationError("cursor is invalid");
  }
}

async function pypiProxyByteCacheStats(
  objectStore: RepositoryObjectStore,
  repositoryName: string,
): Promise<{
  fileCount: number;
  byteCount: number;
  catalogProjectCount?: number;
  catalogRefreshedAt?: string;
}> {
  const objects = await listAllObjects(objectStore, pypiProxyByteCachePrefix(repositoryName));
  const files = objects.filter((object) => !object.key.endsWith(".json"));
  const catalog = await pypiProxyCatalogStats(objectStore, repositoryName);
  return {
    fileCount: files.length,
    byteCount: files.reduce((sum, object) => sum + (object.contentLength ?? 0), 0),
    ...catalog,
  };
}

async function pypiProxyCatalogStats(
  objectStore: RepositoryObjectStore,
  repositoryName: string,
): Promise<{ catalogProjectCount?: number; catalogRefreshedAt?: string }> {
  const object = await objectStore.getObject(`repositories/${repositoryName}/_proxy-cache/pypi/projects.json`);
  if (!object) {
    return {};
  }
  const raw = JSON.parse(new TextDecoder().decode(await objectBytes(object))) as Record<string, unknown>;
  const projects = Array.isArray(raw.projects) ? raw.projects : undefined;
  const refreshedAt = typeof raw.refreshedAt === "string" ? raw.refreshedAt : undefined;
  return {
    ...(projects ? { catalogProjectCount: projects.length } : {}),
    ...(refreshedAt ? { catalogRefreshedAt: refreshedAt } : {}),
  };
}

function pypiProxyByteCachePrefix(repositoryName: string): string {
  return `repositories/${repositoryName}/_proxy-cache/pypi/files/`;
}

export async function readPypiProxyCachedProjects(
  objectStore: RepositoryObjectStore,
  repositoryName: string,
): Promise<Array<{ name: string; files: unknown[] }>> {
  const summaries = await readPypiProxyCachedProjectSummaries(objectStore, repositoryName);
  const projects = await Promise.all(summaries.map((summary) =>
    readPypiProxyCachedProject(objectStore, repositoryName, summary.name),
  ));
  return projects.filter((project): project is { name: string; files: unknown[] } => Boolean(project));
}

export async function readPypiProxyCachedProjectSummaries(
  objectStore: RepositoryObjectStore,
  repositoryName: string,
): Promise<Array<{ name: string; fileCount?: number }>> {
  const object = await objectStore.getObject(`repositories/${repositoryName}/_proxy-cache/pypi/projects.json`);
  if (!object) {
    return [];
  }
  const raw = JSON.parse(new TextDecoder().decode(await objectBytes(object))) as {
    projects?: Array<{ name?: unknown; fileCount?: unknown }>;
  };
  return (raw.projects ?? [])
    .filter((project): project is { name: string; fileCount?: number } =>
      typeof project.name === "string"
      && (project.fileCount === undefined || Number.isSafeInteger(project.fileCount)),
    )
    .map((project) => ({
      name: project.name,
      ...(project.fileCount === undefined ? {} : { fileCount: project.fileCount }),
    }));
}

export async function readPypiProxyCachedProject(
  objectStore: RepositoryObjectStore,
  repositoryName: string,
  projectName: string,
): Promise<{ name: string; files: unknown[] } | undefined> {
  const object = await objectStore.getObject(
    `repositories/${repositoryName}/_proxy-cache/pypi/projects/${encodeURIComponent(normalizeProjectName(projectName))}.json`,
  );
  if (!object) {
    return undefined;
  }
  const raw = JSON.parse(new TextDecoder().decode(await objectBytes(object))) as {
    name?: unknown;
    files?: unknown[];
  };
  if (typeof raw.name !== "string" || !Array.isArray(raw.files)) {
    return undefined;
  }
  return { name: raw.name, files: raw.files };
}

function requireParam(value: string | undefined): string {
  if (!value) {
    throw new NotFoundError();
  }
  return value;
}
