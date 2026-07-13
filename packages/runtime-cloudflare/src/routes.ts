import { AxisError, NotFoundError, ValidationError } from "@axis-repository/core";
import type { AppDependencies } from "./dev-dependencies";
import { optionalObjectField, readJsonObject, requireAdmin, requireBearer, stringArrayField, stringField } from "./http";

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

function repositoryVisibility(body: Record<string, unknown>): "private" | "public" {
  if (body.visibility === undefined) return "private";
  if (body.visibility === "private" || body.visibility === "public") return body.visibility;
  throw new ValidationError("visibility must be private or public");
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
        visibility: repositoryVisibility(body),
        config: optionalObjectField(body, "config") ?? {},
      });
      return jsonResponse(repository, { status: 201 });
    }
  }
  if (url.pathname === "/admin/publish-tokens") {
    requireAdmin(request, dependencies.adminToken);
    if (request.method === "GET") {
      return jsonResponse({ publishTokens: await dependencies.publishTokenService.list() });
    }
    if (request.method === "POST") {
      const body = await readJsonObject(request);
      const result = await dependencies.publishTokenService.create({
        name: stringField(body, "name"),
        repositories: stringArrayField(body, "repositories"),
        permissions: stringArrayField(body, "permissions"),
        ecosystemScopes: optionalObjectField(body, "ecosystemScopes") ?? {},
      });
      return jsonResponse(
        {
          token: { ...result.record, tokenHash: undefined },
          secret: result.secret,
        },
        { status: 201 },
      );
    }
  }
  if (url.pathname === "/api/publish-sessions" && request.method === "POST") {
    const secret = requireBearer(request);
    const principal = await dependencies.publishTokenService.verify(secret);
    const body = await readJsonObject(request);
    const artifacts = body.artifacts;
    if (!Array.isArray(artifacts)) {
      throw new ValidationError("artifacts must be an array");
    }
    const session = await dependencies.publishSessionService.create({
      repositoryName: stringField(body, "repositoryName"),
      ecosystem: stringField(body, "ecosystem"),
      principal,
      artifacts: artifacts as never,
    });
    return jsonResponse(session, { status: 201 });
  }
  throw new NotFoundError();
}
