import {
  AxisError,
  NotFoundError,
  ValidationError,
  type PublishArtifactRequest,
  type PublishTokenRecord,
} from "@axis-repository/core";
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

function publicPublishToken(record: PublishTokenRecord): Omit<PublishTokenRecord, "tokenHash"> {
  const { tokenHash, ...publicRecord } = record;
  return publicRecord;
}

function requiredStringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ValidationError(`${label} is required`);
  }
  return value;
}

function optionalStringField(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new ValidationError(`${key} must be a string`);
  }
  return value;
}

function parseArtifact(value: unknown, index: number): PublishArtifactRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError(`artifacts[${index}] must be an object`);
  }
  const artifact = value as Record<string, unknown>;
  const size = artifact.size;
  const filename = requiredStringValue(artifact.filename, `artifacts[${index}].filename`);
  const sha256 = requiredStringValue(artifact.sha256, `artifacts[${index}].sha256`);
  const contentType = requiredStringValue(artifact.contentType, `artifacts[${index}].contentType`);
  if (!/^[a-fA-F0-9]{64}$/.test(sha256)) {
    throw new ValidationError(`artifacts[${index}].sha256 must be a 64-character hex digest`);
  }
  if (typeof size !== "number" || !Number.isFinite(size) || size < 0) {
    throw new ValidationError(`artifacts[${index}].size must be a finite non-negative number`);
  }
  const metadata = artifact.metadata ?? {};
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new ValidationError(`artifacts[${index}].metadata must be an object`);
  }
  return {
    filename,
    size,
    sha256,
    contentType,
    metadata: metadata as Record<string, unknown>,
  };
}

function parseArtifacts(body: Record<string, unknown>): PublishArtifactRequest[] {
  const artifacts = body.artifacts;
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    throw new ValidationError("artifacts must be a non-empty array");
  }
  return artifacts.map((artifact, index) => parseArtifact(artifact, index));
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
      const publishTokens = await dependencies.publishTokenService.list();
      return jsonResponse({ publishTokens: publishTokens.map(publicPublishToken) });
    }
    if (request.method === "POST") {
      const body = await readJsonObject(request);
      const expiresAt = optionalStringField(body, "expiresAt");
      const result = await dependencies.publishTokenService.create({
        name: stringField(body, "name"),
        repositories: stringArrayField(body, "repositories"),
        permissions: stringArrayField(body, "permissions"),
        ecosystemScopes: optionalObjectField(body, "ecosystemScopes") ?? {},
        ...(expiresAt === undefined ? {} : { expiresAt }),
      });
      return jsonResponse(
        {
          token: publicPublishToken(result.record),
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
    const artifacts = parseArtifacts(body);
    const session = await dependencies.publishSessionService.create({
      repositoryName: stringField(body, "repositoryName"),
      ecosystem: stringField(body, "ecosystem"),
      principal,
      artifacts,
    });
    return jsonResponse(session, { status: 201 });
  }
  const verifyUploadMatch = url.pathname.match(
    /^\/api\/publish-sessions\/([^/]+)\/uploads\/([^/]+)\/verify$/,
  );
  if (verifyUploadMatch && request.method === "POST") {
    const [, sessionId, uploadId] = verifyUploadMatch;
    if (!sessionId || !uploadId) {
      throw new NotFoundError();
    }
    const secret = requireBearer(request);
    const principal = await dependencies.publishTokenService.verify(secret);
    const result = await dependencies.publishSessionService.verifyUpload({
      sessionId,
      uploadId,
      principal,
    });
    return jsonResponse(result);
  }
  const finalizeMatch = url.pathname.match(/^\/api\/publish-sessions\/([^/]+)\/finalize$/);
  if (finalizeMatch && request.method === "POST") {
    const [, sessionId] = finalizeMatch;
    if (!sessionId) {
      throw new NotFoundError();
    }
    const secret = requireBearer(request);
    const principal = await dependencies.publishTokenService.verify(secret);
    const result = await dependencies.publishSessionService.finalize({
      sessionId,
      principal,
    });
    return jsonResponse(result);
  }
  throw new NotFoundError();
}
