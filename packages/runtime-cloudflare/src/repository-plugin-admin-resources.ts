import { NotFoundError, type Repository } from "@axis-repository/core";
import type { RepositoryRuntimePluginServices } from "./repository-plugin-capabilities";

export type RepositoryAdminResourceServices = RepositoryRuntimePluginServices;

export interface RepositoryAdminResourceInput {
  repositoryName: string;
  repository?: Repository;
  request: Request;
  path: string[];
  services: RepositoryAdminResourceServices;
}

export interface RepositoryAdminResourceRouteInput extends Omit<RepositoryAdminResourceInput, "path"> {
  params: Record<string, string>;
}

export interface RepositoryAdminResourceRoute {
  method: string;
  path: string[];
  handle(input: RepositoryAdminResourceRouteInput): Promise<Response>;
}

export interface RepositoryAdminResources {
  namespace: string;
  routes: RepositoryAdminResourceRoute[];
}

function matchAdminResourceRoute(
  route: RepositoryAdminResourceRoute,
  method: string,
  path: readonly string[],
): Record<string, string> | null {
  if (route.method.toUpperCase() !== method.toUpperCase() || route.path.length !== path.length) {
    return null;
  }
  const params: Record<string, string> = {};
  for (let index = 0; index < route.path.length; index += 1) {
    const expected = route.path[index]!;
    const actual = path[index]!;
    if (expected.startsWith(":")) {
      const name = expected.slice(1);
      if (!name) return null;
      params[name] = actual;
      continue;
    }
    if (expected !== actual) {
      return null;
    }
  }
  return params;
}

export async function dispatchRepositoryAdminResource(
  adminResources: RepositoryAdminResources,
  input: RepositoryAdminResourceInput,
): Promise<Response> {
  for (const route of adminResources.routes) {
    const params = matchAdminResourceRoute(route, input.request.method, input.path);
    if (!params) continue;
    return route.handle({
      repositoryName: input.repositoryName,
      ...(input.repository ? { repository: input.repository } : {}),
      request: input.request,
      services: input.services,
      params,
    });
  }
  throw new NotFoundError(
    `Repository admin resource route is not configured: ${input.request.method.toUpperCase()} ${input.path.join("/")}`,
  );
}
