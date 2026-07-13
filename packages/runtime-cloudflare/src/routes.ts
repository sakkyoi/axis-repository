import { AxisError, NotFoundError } from "@axis-repository/core";
import type { AppDependencies } from "./dev-dependencies";
import { optionalObjectField, readJsonObject, requireAdmin, stringField } from "./http";

export interface AxisApp {
  fetch(request: Request): Promise<Response>;
}

export function jsonResponse(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init?.headers ?? {}),
    },
  });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof AxisError) {
    return jsonResponse({ error: { code: error.code, message: error.message } }, { status: error.status });
  }
  return jsonResponse(
    { error: { code: "internal_error", message: "Internal Server Error" } },
    { status: 500 },
  );
}

export async function dispatch(request: Request, dependencies: AppDependencies): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/health") {
    return jsonResponse({ ok: true, service: "axis-repository" });
  }
  if (url.pathname === "/admin/repositories") {
    requireAdmin(request, dependencies.adminToken);
    if (request.method === "GET") {
      return jsonResponse({ repositories: await dependencies.repositoryService.list() });
    }
    if (request.method === "POST") {
      const body = await readJsonObject(request);
      const repository = await dependencies.repositoryService.create({
        name: stringField(body, "name"),
        ecosystem: stringField(body, "ecosystem"),
        visibility: body.visibility === "public" ? "public" : "private",
        config: optionalObjectField(body, "config") ?? {},
      });
      return jsonResponse(repository, { status: 201 });
    }
  }
  throw new NotFoundError();
}
