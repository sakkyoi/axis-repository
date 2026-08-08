import { NotFoundError, ValidationError, type RepositoryArtifactStore, type RepositoryObjectStore } from "@axis-repository/core";
import type { RepositoryAdminResources } from "@axis-repository/runtime-cloudflare/plugin-runtime";
import { objectBytes, pluginJsonResponse, readJsonObject } from "@axis-repository/runtime-cloudflare/plugin-runtime";
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

/**
 * Yanking, as PEP 592 defines it.
 *
 * A yanked file stays downloadable — anything that already pins it keeps
 * working — but a resolver passes over it unless nothing else satisfies the
 * requirement. That is what makes it the right answer for a broken release,
 * where deleting would break whoever already depends on it.
 */
export function createPypiAdminResources(input: {
  objectStoreFor: (repositoryName: string) => RepositoryObjectStore;
  fetchProxyProject?: (input: {
    repositoryName: string;
    repositoryEcosystem: string;
    repositoryConfig: Record<string, unknown>;
    artifactStore: RepositoryArtifactStore | undefined;
    project: string;
    cachedProject?: { name: string; files: unknown[] };
  }) => Promise<{ name: string; files: unknown[] } | undefined>;
}): RepositoryAdminResources {
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
        handle: async ({ repository, repositoryName, request }) => {
          const objectStore = input.objectStoreFor(repositoryName);
          const pageParams = projectPageParams(new URL(request.url).searchParams);
          if (repository?.kind === "proxy") {
            const projects = await readPypiProxyCachedProjectSummaries(objectStore, repositoryName);
            return pluginJsonResponse({
              ...projectPage(projects
                .slice(pageParams.offset, pageParams.offset + pageParams.limit)
                .map((project) => ({ name: project.name, fileCount: project.fileCount })), projects.length, pageParams),
            });
          }
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
        handle: async ({ repository, repositoryName, params, services }) => {
          const objectStore = input.objectStoreFor(repositoryName);
          const project = normalizeProjectName(requireParam(params.project));
          if (repository?.kind === "proxy") {
            const cached = await readPypiProxyCachedProject(objectStore, repositoryName, project);
            const synced = await input.fetchProxyProject?.({
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
          }
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
