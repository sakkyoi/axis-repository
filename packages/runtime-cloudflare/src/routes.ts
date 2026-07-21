import {
  AxisError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
  type PublishArtifactRequest,
  type PublishTokenRecord,
  type Repository,
  type RepositoryVisibility,
  type RepositoryObject,
  type RepositoryObjectMetadata,
  type RepositoryObjectRange,
} from "@axis-repository/core";
import { buildAptInstallInfo, buildAptSourceInfo, type AptClientRepositoryInfo } from "./apt-client";
import { parseAptRepositoryConfig } from "./apt-metadata";
import { adminUiAssets, injectAdminUiRuntimeConfig, type AdminUiAsset } from "./admin-ui-assets";
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

function optionalRepositoryVisibility(body: Record<string, unknown>): RepositoryVisibility | undefined {
  if (body.visibility === undefined) return undefined;
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

function optionalStringArrayField(body: Record<string, unknown>, key: string): string[] | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new ValidationError(`${key} must be an array of strings`);
  }
  return [...value];
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

interface ParsedRange {
  range: RepositoryObjectRange;
  end: number;
}

function repositoryCacheControl(repository: Repository): string {
  return repository.visibility === "public" ? "public, max-age=300" : "private, no-store";
}

function parseRangeHeader(rangeHeader: string | null, contentLength: number | undefined): ParsedRange | null {
  if (!rangeHeader) {
    return null;
  }
  if (
    contentLength === undefined
    || contentLength <= 0
    || !rangeHeader.startsWith("bytes=")
    || rangeHeader.includes(",")
  ) {
    return null;
  }

  const spec = rangeHeader.slice("bytes=".length);
  const match = spec.match(/^(\d*)-(\d*)$/);
  if (!match) {
    return null;
  }
  const [, startText, endText] = match;
  if (startText === "" && endText === "") {
    return null;
  }

  if (startText === "") {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return null;
    }
    const length = Math.min(suffixLength, contentLength);
    const offset = contentLength - length;
    return { range: { offset, length }, end: contentLength - 1 };
  }

  const start = Number(startText);
  const requestedEnd = endText === "" ? contentLength - 1 : Number(endText);
  if (
    !Number.isSafeInteger(start)
    || !Number.isSafeInteger(requestedEnd)
    || start < 0
    || requestedEnd < start
    || start >= contentLength
  ) {
    return null;
  }
  const end = Math.min(requestedEnd, contentLength - 1);
  return { range: { offset: start, length: end - start + 1 }, end };
}

function objectHeaders(input: {
  metadata: RepositoryObjectMetadata;
  contentLength?: number;
  cacheControl: string;
  range?: ParsedRange;
}): Headers {
  const headers = new Headers();
  if (input.metadata.contentType) {
    headers.set("content-type", input.metadata.contentType);
  }
  if (input.contentLength !== undefined) {
    headers.set("content-length", String(input.contentLength));
  }
  if (input.metadata.contentLength !== undefined) {
    headers.set("accept-ranges", "bytes");
  }
  if (input.metadata.etag) {
    headers.set("etag", input.metadata.etag);
  }
  headers.set("cache-control", input.cacheControl);
  if (input.range && input.metadata.contentLength !== undefined) {
    headers.set(
      "content-range",
      `bytes ${input.range.range.offset}-${input.range.end}/${input.metadata.contentLength}`,
    );
  }
  return headers;
}

function rangeNotSatisfiableResponse(metadata: RepositoryObjectMetadata, cacheControl: string): Response {
  const headers = new Headers();
  if (metadata.contentLength !== undefined) {
    headers.set("content-range", `bytes */${metadata.contentLength}`);
    headers.set("accept-ranges", "bytes");
  }
  if (metadata.etag) {
    headers.set("etag", metadata.etag);
  }
  headers.set("cache-control", cacheControl);
  return new Response(null, { status: 416, headers });
}

function objectResponse(input: {
  method: "GET" | "HEAD";
  object: RepositoryObject | null;
  metadata: RepositoryObjectMetadata;
  cacheControl: string;
  range?: ParsedRange;
}): Response {
  const responseLength = input.range?.range.length ?? input.metadata.contentLength;
  return new Response(input.method === "HEAD" ? null : input.object?.body ?? null, {
    status: input.range ? 206 : 200,
    headers: objectHeaders({
      metadata: input.metadata,
      cacheControl: input.cacheControl,
      ...(responseLength !== undefined ? { contentLength: responseLength } : {}),
      ...(input.range ? { range: input.range } : {}),
    }),
  });
}

function adminUiAssetResponse(asset: AdminUiAsset): Response {
  const isHtml = asset.contentType.startsWith("text/html");
  return new Response(isHtml ? injectAdminUiRuntimeConfig(asset.body, { apiBaseUrl: "" }) : asset.body, {
    headers: {
      "content-type": asset.contentType,
      "cache-control": isHtml ? "no-store" : "public, max-age=31536000, immutable",
    },
  });
}

function adminUiResponse(pathname: string): Response | null {
  if (
    pathname === "/health"
    || pathname === "/admin"
    || pathname === "/api"
    || pathname === "/repositories"
    || pathname.startsWith("/admin/")
    || pathname.startsWith("/api/")
    || pathname.startsWith("/repositories/")
  ) {
    return null;
  }
  const asset = adminUiAssets.get(pathname);
  if (asset) {
    return adminUiAssetResponse(asset);
  }
  if (pathname.startsWith("/assets/")) {
    return null;
  }
  return adminUiAssetResponse(adminUiAssets.get("/")!);
}

function rawPathname(requestUrl: string): string {
  const withoutOrigin = requestUrl.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, "");
  const path = withoutOrigin.split(/[?#]/, 1)[0] ?? "";
  return path || "/";
}

function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new NotFoundError();
  }
}

function parseRepositoryObjectPath(requestUrl: string): { repositoryName: string; relativePath: string } | null {
  const rawPath = rawPathname(requestUrl);
  const prefix = "/repositories/";
  if (!rawPath.startsWith(prefix)) {
    return null;
  }
  const rawRest = rawPath.slice(prefix.length);
  const rawSegments = rawRest.split("/");
  if (rawSegments.length < 2) {
    return null;
  }
  const decodedSegments = rawSegments.map(decodePathSegment);
  if (decodedSegments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new NotFoundError();
  }
  const [repositoryName, ...relativeSegments] = decodedSegments;
  if (!repositoryName || relativeSegments.length === 0) {
    return null;
  }
  return {
    repositoryName,
    relativePath: relativeSegments.join("/"),
  };
}

function parseAdminResourcePath(requestUrl: string, collection: string): string | null {
  const rawPath = rawPathname(requestUrl);
  const prefix = `/admin/${collection}/`;
  if (!rawPath.startsWith(prefix)) {
    return null;
  }
  const rawRest = rawPath.slice(prefix.length);
  const rawSegments = rawRest.split("/");
  if (rawSegments.length !== 1) {
    return null;
  }
  const value = decodePathSegment(rawSegments[0] ?? "");
  if (!value || value === "." || value === "..") {
    throw new NotFoundError();
  }
  return value;
}

function parseAdminResourceActionPath(requestUrl: string, collection: string, action: string): string | null {
  const rawPath = rawPathname(requestUrl);
  const prefix = `/admin/${collection}/`;
  if (!rawPath.startsWith(prefix)) {
    return null;
  }
  const rawSegments = rawPath.slice(prefix.length).split("/");
  if (rawSegments.length !== 2 || rawSegments[1] !== action) {
    return null;
  }
  const value = decodePathSegment(rawSegments[0] ?? "");
  if (!value || value === "." || value === "..") {
    throw new NotFoundError();
  }
  return value;
}

function parseRepositoryUpdate(body: Record<string, unknown>): {
  visibility?: RepositoryVisibility;
  config?: Record<string, unknown>;
} {
  if (body.name !== undefined || body.ecosystem !== undefined) {
    throw new ValidationError("Repository name and ecosystem are immutable");
  }
  const visibility = optionalRepositoryVisibility(body);
  const config = optionalObjectField(body, "config");
  return {
    ...(visibility === undefined ? {} : { visibility }),
    ...(config === undefined ? {} : { config }),
  };
}

type AptHelperAction = "key.gpg" | "source" | "install";

function parseAptHelperPath(requestUrl: string): { repositoryName: string; action: AptHelperAction } | null {
  const rawPath = rawPathname(requestUrl);
  const prefix = "/repositories/";
  if (!rawPath.startsWith(prefix)) {
    return null;
  }
  const rawSegments = rawPath.slice(prefix.length).split("/");
  if (rawSegments.length !== 3 || rawSegments[1] !== "apt") {
    return null;
  }
  const [rawRepositoryName, , rawAction] = rawSegments;
  if (!rawRepositoryName || !rawAction) {
    throw new NotFoundError();
  }
  const repositoryName = decodePathSegment(rawRepositoryName);
  const action = decodePathSegment(rawAction);
  if (!repositoryName || repositoryName === "." || repositoryName === "..") {
    throw new NotFoundError();
  }
  if (action !== "key.gpg" && action !== "source" && action !== "install") {
    return null;
  }
  return { repositoryName, action };
}

function assertAptRepository(repository: Repository): void {
  if (repository.ecosystem !== "apt") {
    throw new NotFoundError();
  }
}

function aptClientRepositoryInfo(repository: Repository): AptClientRepositoryInfo {
  const config = parseAptRepositoryConfig(repository);
  return {
    name: repository.name,
    visibility: repository.visibility,
    codename: config.codename,
    components: config.components,
  };
}

function aptPublicKeyResponse(publicKeyArmored: string, repository: Repository): Response {
  const headers = new Headers();
  headers.set("content-type", "application/pgp-keys");
  headers.set("cache-control", repositoryCacheControl(repository));
  return new Response(publicKeyArmored, { headers });
}

function ensureRepositoryPathIsServable(
  dependencies: AppDependencies,
  repository: Repository,
  relativePath: string,
): void {
  const plugin = dependencies.artifactPublisherRegistry.getPlugin(repository.ecosystem);
  if (!plugin?.canServeRepositoryPath({ relativePath })) {
    throw new NotFoundError();
  }
}

async function authorizeRepositoryRead(
  request: Request,
  dependencies: AppDependencies,
  repository: Repository,
): Promise<void> {
  if (repository.visibility === "public") {
    return;
  }
  const secret = requireRepositoryReadSecret(request);
  const principal = await dependencies.publishTokenService.verify(secret);
  if (!principal.repositories.includes(repository.name) || !principal.permissions.includes("read")) {
    throw new ForbiddenError();
  }
}

function requireRepositoryReadSecret(request: Request): string {
  const authorization = request.headers.get("authorization");
  if (!authorization) {
    throw new UnauthorizedError();
  }
  if (/^Bearer\s+/i.test(authorization)) {
    return requireBearer(request);
  }
  if (/^Basic\s+/i.test(authorization)) {
    return requireBasicPassword(authorization.slice(authorization.indexOf(" ") + 1).trim());
  }
  throw new UnauthorizedError();
}

function requireBasicPassword(encodedCredentials: string): string {
  let credentials: string;
  try {
    credentials = atob(encodedCredentials);
  } catch {
    throw new UnauthorizedError();
  }
  const separator = credentials.indexOf(":");
  if (separator < 0) {
    throw new UnauthorizedError();
  }
  const password = credentials.slice(separator + 1);
  if (!password) {
    throw new UnauthorizedError();
  }
  return password;
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
  const adminRepositoryName = parseAdminResourcePath(request.url, "repositories");
  if (adminRepositoryName) {
    requireAdmin(request, dependencies.adminToken);
    if (request.method === "GET") {
      return jsonResponse(await dependencies.repositoryService.getByName(adminRepositoryName));
    }
    if (request.method === "PATCH") {
      const body = await readJsonObject(request);
      return jsonResponse(
        await dependencies.repositoryService.update(adminRepositoryName, parseRepositoryUpdate(body)),
      );
    }
    throw new NotFoundError();
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
      const signingKeyIds = optionalStringArrayField(body, "signingKeyIds");
      const result = await dependencies.publishTokenService.create({
        name: stringField(body, "name"),
        repositories: stringArrayField(body, "repositories"),
        permissions: stringArrayField(body, "permissions"),
        ecosystemScopes: optionalObjectField(body, "ecosystemScopes") ?? {},
        ...(expiresAt === undefined ? {} : { expiresAt }),
        ...(signingKeyIds === undefined ? {} : { signingKeyIds }),
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
  const revokePublishTokenName = parseAdminResourceActionPath(request.url, "publish-tokens", "revoke");
  if (revokePublishTokenName) {
    requireAdmin(request, dependencies.adminToken);
    if (request.method !== "POST") {
      throw new NotFoundError();
    }
    return jsonResponse(publicPublishToken(await dependencies.publishTokenService.revoke(revokePublishTokenName)));
  }
  const adminPublishTokenName = parseAdminResourcePath(request.url, "publish-tokens");
  if (adminPublishTokenName) {
    requireAdmin(request, dependencies.adminToken);
    if (request.method === "GET") {
      return jsonResponse(publicPublishToken(await dependencies.publishTokenService.getByName(adminPublishTokenName)));
    }
    throw new NotFoundError();
  }
  if (url.pathname === "/admin/signing-keys") {
    requireAdmin(request, dependencies.adminToken);
    if (request.method === "GET") {
      return jsonResponse({
        signingKeys: await dependencies.signingKeyService.list(),
      });
    }
    if (request.method === "POST") {
      const body = await readJsonObject(request);
      const key = await dependencies.signingKeyService.create({
        name: stringField(body, "name"),
        privateKeyArmored: stringField(body, "privateKeyArmored"),
        passphrase: stringField(body, "passphrase"),
      });
      return jsonResponse(key, { status: 201 });
    }
  }
  const revokeSigningKeyMatch = url.pathname.match(
    /^\/admin\/signing-keys\/([^/]+)\/revoke$/,
  );
  if (revokeSigningKeyMatch) {
    requireAdmin(request, dependencies.adminToken);
    if (request.method !== "POST") {
      throw new NotFoundError();
    }
    const [, id] = revokeSigningKeyMatch;
    if (!id) {
      throw new NotFoundError();
    }
    return jsonResponse(await dependencies.signingKeyService.revoke(id));
  }
  const adminSigningKeyId = parseAdminResourcePath(request.url, "signing-keys");
  if (adminSigningKeyId) {
    requireAdmin(request, dependencies.adminToken);
    if (request.method === "GET") {
      return jsonResponse(await dependencies.signingKeyService.getPublicKey(adminSigningKeyId));
    }
    throw new NotFoundError();
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
  const aptHelperPath = parseAptHelperPath(request.url);
  if (aptHelperPath && request.method === "GET") {
    const repository = await dependencies.repositoryService.getByName(aptHelperPath.repositoryName);
    assertAptRepository(repository);
    await authorizeRepositoryRead(request, dependencies, repository);
    const repositoryInfo = aptClientRepositoryInfo(repository);

    if (aptHelperPath.action === "key.gpg") {
      const config = parseAptRepositoryConfig(repository);
      const key = await dependencies.signingKeyService.getPublicKey(config.signingKeyId);
      return aptPublicKeyResponse(key.publicKeyArmored, repository);
    }
    if (aptHelperPath.action === "source") {
      return jsonResponse(buildAptSourceInfo({ origin: url.origin, repository: repositoryInfo }));
    }
    return jsonResponse(buildAptInstallInfo({ origin: url.origin, repository: repositoryInfo }));
  }
  const repositoryObjectPath = parseRepositoryObjectPath(request.url);
  if (repositoryObjectPath && (request.method === "GET" || request.method === "HEAD")) {
    const { repositoryName, relativePath } = repositoryObjectPath;
    const repository = await dependencies.repositoryService.getByName(repositoryName);
    ensureRepositoryPathIsServable(dependencies, repository, relativePath);
    await authorizeRepositoryRead(request, dependencies, repository);
    const objectKey = `repositories/${repositoryName}/${relativePath}`;
    const metadata = await dependencies.repositoryObjectStore.headObject(objectKey);
    if (!metadata) {
      throw new NotFoundError();
    }
    const cacheControl = repositoryCacheControl(repository);
    const rangeHeader = request.method === "GET" ? request.headers.get("range") : null;
    const parsedRange = parseRangeHeader(rangeHeader, metadata.contentLength);
    if (rangeHeader && !parsedRange) {
      return rangeNotSatisfiableResponse(metadata, cacheControl);
    }
    const object = request.method === "HEAD"
      ? null
      : await dependencies.repositoryObjectStore.getObject(
        objectKey,
        parsedRange ? { range: parsedRange.range } : undefined,
      );
    if (request.method === "GET" && !object) {
      throw new NotFoundError();
    }
    return objectResponse({
      method: request.method,
      object,
      metadata,
      cacheControl,
      ...(parsedRange ? { range: parsedRange } : {}),
    });
  }
  if (request.method === "GET") {
    const uiResponse = adminUiResponse(url.pathname);
    if (uiResponse) {
      return uiResponse;
    }
  }
  throw new NotFoundError();
}
