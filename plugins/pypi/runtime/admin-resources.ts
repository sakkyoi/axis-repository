import { NotFoundError, ValidationError, type RepositoryObjectStore } from "@axis-repository/core";
import type { RepositoryAdminResources } from "@axis-repository/runtime-cloudflare/plugin-runtime";
import { pluginJsonResponse, readJsonObject } from "@axis-repository/runtime-cloudflare/plugin-runtime";
import { pypiPluginManifest } from "../manifest";
import { listProjects, readPublishedProjectFiles, writeSimpleIndexes } from "./index-store";
import { normalizeProjectName } from "../shared/names";

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
        handle: async ({ repositoryName }) => {
          // Read from the published pages rather than the artifact index, so
          // what an operator sees is what clients are being served, yank state
          // included.
          const objectStore = input.objectStoreFor(repositoryName);
          const projects = await listProjects(objectStore, repositoryName);
          return pluginJsonResponse({
            projects: await Promise.all(projects.map(async (project) => ({
              name: project,
              files: await readPublishedProjectFiles({ objectStore, repositoryName, project }),
            }))),
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

function requireParam(value: string | undefined): string {
  if (!value) {
    throw new NotFoundError();
  }
  return value;
}
