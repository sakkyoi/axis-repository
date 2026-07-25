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
  type RepositoryObjectList,
  type RepositoryObjectMetadata,
  type RepositoryObjectRange,
} from "@axis-repository/core";
import { getRepositoryPluginCatalogEntry, repositoryPluginCatalog } from "../../../../plugins/catalog";
import { adminUiAssets, injectAdminUiRuntimeConfig, type AdminUiAsset } from "../admin-ui-assets";
import type { AppDependencies } from "./dev-dependencies";
import { optionalObjectField, readJsonObject, requireAdmin, requireBearer, stringArrayField, stringField } from "../http";
import {
  ensureRepositoryPluginEnabled as ensureEffectiveRepositoryPluginEnabled,
  repositoryPluginPolicyFields,
} from "../plugins/repository-plugin-policy";
import { dispatchRepositoryAdminResource } from "../plugins/repository-plugin-admin-resources";
import { dispatchRepositoryClientHelper } from "../plugins/repository-plugin-client-helpers";

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

async function repositoryPluginMetadata(dependencies: AppDependencies) {
  const registeredPlugins = dependencies.repositoryRuntimePlugins.list();
  const registeredPluginsByEcosystem = new Map(
    registeredPlugins.map((plugin) => [plugin.ecosystem, plugin]),
  );
  const catalogPlugins = await Promise.all(repositoryPluginCatalog.map(async (catalogEntry) => {
    const plugin = registeredPluginsByEcosystem.get(catalogEntry.manifest.ecosystem);
    const policy = await repositoryPluginPolicyFields({
      pluginPolicyService: dependencies.pluginPolicyService,
      ecosystem: catalogEntry.manifest.ecosystem,
      catalogEnabled: catalogEntry.enabled,
    });
    return {
      ecosystem: catalogEntry.manifest.ecosystem,
      name: catalogEntry.manifest.runtimeName,
      version: catalogEntry.manifest.version,
      capabilities: [...catalogEntry.manifest.capabilities],
      ...(catalogEntry.manifest.clientHelpers
        ? {
            clientHelpers: {
              namespace: catalogEntry.manifest.clientHelpers.namespace,
              actions: catalogEntry.manifest.clientHelpers.actions.map((action) => ({ ...action })),
            },
          }
        : {}),
      ...plugin,
      ...policy,
      experimental: catalogEntry.experimental,
      runtime: catalogEntry.runtime,
      adminUi: catalogEntry.adminUi,
    };
  }));
  const catalogEcosystems = new Set<string>(repositoryPluginCatalog.map((entry) => entry.manifest.ecosystem));
  const uncatalogedPlugins = await Promise.all(registeredPlugins
    .filter((plugin) => !catalogEcosystems.has(plugin.ecosystem))
    .map(async (plugin) => {
      const catalogEntry = getRepositoryPluginCatalogEntry(plugin.ecosystem);
      const policy = await repositoryPluginPolicyFields({
        pluginPolicyService: dependencies.pluginPolicyService,
        ecosystem: plugin.ecosystem,
        catalogEnabled: catalogEntry?.enabled ?? true,
      });
      return {
        ...plugin,
        ...policy,
        experimental: catalogEntry?.experimental ?? false,
        runtime: catalogEntry?.runtime ?? true,
        adminUi: catalogEntry?.adminUi ?? false,
      };
    }));
  return [...catalogPlugins, ...uncatalogedPlugins];
}

async function repositoryPluginMetadataByEcosystem(dependencies: AppDependencies, ecosystem: string) {
  const plugin = (await repositoryPluginMetadata(dependencies)).find((candidate) => candidate.ecosystem === ecosystem);
  if (!plugin) {
    throw new NotFoundError(`Repository plugin not found: ${ecosystem}`);
  }
  return plugin;
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

function adminUiAssetResponse(asset: AdminUiAsset, dependencies: AppDependencies): Response {
  const isHtml = asset.contentType.startsWith("text/html");
  return new Response(
    isHtml ? injectAdminUiRuntimeConfig(asset.body, dependencies.adminUiRuntimeConfig) : asset.body,
    {
      headers: {
        "content-type": asset.contentType,
        "cache-control": isHtml ? "no-store" : "public, max-age=31536000, immutable",
      },
    },
  );
}

function adminUiResponse(pathname: string, dependencies: AppDependencies): Response | null {
  if (pathname === "/" || pathname === "/ui") {
    return new Response(null, { status: 302, headers: { location: "/ui/" } });
  }
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
    return adminUiAssetResponse(asset, dependencies);
  }
  if (pathname.startsWith("/assets/")) {
    return null;
  }
  if (!pathname.startsWith("/ui/")) {
    return null;
  }
  return adminUiAssetResponse(adminUiAssets.get("/")!, dependencies);
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

function parseRepositoryPluginPolicyUpdate(body: Record<string, unknown>): boolean | null {
  if (!Object.prototype.hasOwnProperty.call(body, "enabled")) {
    throw new ValidationError("enabled must be boolean or null");
  }
  if (body.enabled === true || body.enabled === false || body.enabled === null) {
    return body.enabled;
  }
  throw new ValidationError("enabled must be boolean or null");
}

function parseRepositoryClientHelperPath(requestUrl: string): {
  repositoryName: string;
  namespace: string;
  action: string;
} | null {
  const rawPath = rawPathname(requestUrl);
  const prefix = "/repositories/";
  if (!rawPath.startsWith(prefix)) {
    return null;
  }
  const rawSegments = rawPath.slice(prefix.length).split("/");
  if (rawSegments.length !== 3) {
    return null;
  }
  const [rawRepositoryName, rawNamespace, rawAction] = rawSegments;
  if (!rawRepositoryName || !rawNamespace || !rawAction) {
    throw new NotFoundError();
  }
  const repositoryName = decodePathSegment(rawRepositoryName);
  const namespace = decodePathSegment(rawNamespace);
  const action = decodePathSegment(rawAction);
  if (
    !repositoryName
    || repositoryName === "."
    || repositoryName === ".."
    || !namespace
    || namespace === "."
    || namespace === ".."
    || !action
    || action === "."
    || action === ".."
  ) {
    throw new NotFoundError();
  }
  return { repositoryName, namespace, action };
}

function repositoryClientHelpers(dependencies: AppDependencies, repository: Repository, namespace: string) {
  const plugin = dependencies.repositoryRuntimePlugins.getPlugin(repository.ecosystem);
  const helpers = plugin?.clientHelpers;
  if (!helpers || helpers.namespace !== namespace) {
    return undefined;
  }
  return helpers;
}

function repositoryClientHelperAction(
  helpers: NonNullable<ReturnType<typeof repositoryClientHelpers>>,
  action: string,
) {
  return helpers.actions.find((helperAction) => helperAction.name === action);
}

function repositoryClientHelperContext(_dependencies: AppDependencies, origin: string) {
  return {
    origin,
  };
}

async function ensureRepositoryPluginEnabled(
  dependencies: AppDependencies,
  ecosystem: string,
  errorFactory: () => Error = () => new ValidationError(`Repository plugin is disabled: ${ecosystem}`),
): Promise<void> {
  await ensureEffectiveRepositoryPluginEnabled({
    pluginPolicyService: dependencies.pluginPolicyService,
    ecosystem,
    catalogEnabled: getRepositoryPluginCatalogEntry(ecosystem)?.enabled ?? true,
    errorFactory,
  });
}

function parseAdminRepositoryClientHelperPath(pathname: string): {
  repositoryName: string;
  namespace: string;
  action: string;
} | null {
  const match = pathname.match(/^\/admin\/repositories\/([^/]+)\/([^/]+)\/client\/([^/]+)$/);
  if (!match) return null;
  const repositoryName = decodePathSegment(match[1] ?? "");
  const namespace = decodePathSegment(match[2] ?? "");
  const action = decodePathSegment(match[3] ?? "");
  if (
    !repositoryName
    || repositoryName === "."
    || repositoryName === ".."
    || !namespace
    || namespace === "."
    || namespace === ".."
    || !action
    || action === "."
    || action === ".."
  ) {
    throw new NotFoundError();
  }
  return { repositoryName, namespace, action };
}

function parseAdminRepositoryObjectsPath(pathname: string): string | null {
  const match = pathname.match(/^\/admin\/repositories\/([^/]+)\/objects$/);
  if (!match) return null;
  const repositoryName = decodePathSegment(match[1] ?? "");
  if (!repositoryName || repositoryName === "." || repositoryName === "..") {
    throw new NotFoundError();
  }
  return repositoryName;
}

function parseAdminRepositoryPluginResourcePath(requestUrl: string): {
  repositoryName: string;
  namespace: string;
  path: string[];
} | null {
  const rawPath = rawPathname(requestUrl);
  const prefix = "/admin/repositories/";
  if (!rawPath.startsWith(prefix)) {
    return null;
  }
  const rawSegments = rawPath.slice(prefix.length).split("/");
  if (rawSegments.length < 3) {
    return null;
  }
  const [rawRepositoryName, rawNamespace, ...rawPathSegments] = rawSegments;
  if (!rawRepositoryName || !rawNamespace || rawPathSegments.some((segment) => !segment)) {
    throw new NotFoundError();
  }
  const repositoryName = decodePathSegment(rawRepositoryName);
  const namespace = decodePathSegment(rawNamespace);
  const path = rawPathSegments.map(decodePathSegment);
  if (
    !repositoryName
    || repositoryName === "."
    || repositoryName === ".."
    || !namespace
    || namespace === "."
    || namespace === ".."
    || path.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new NotFoundError();
  }
  return { repositoryName, namespace, path };
}

async function ensureRepositoryPathIsServable(
  dependencies: AppDependencies,
  repository: Repository,
  relativePath: string,
): Promise<void> {
  await ensureRepositoryPluginEnabled(dependencies, repository.ecosystem, () => new NotFoundError());
  const plugin = dependencies.repositoryRuntimePlugins.getPlugin(repository.ecosystem);
  if (!plugin?.canServeRepositoryPath({ relativePath })) {
    throw new NotFoundError();
  }
}

function repositoryObjectListPrefix(value: string | null): string {
  if (!value) {
    return "";
  }
  if (value.startsWith("/") || value.includes("\\") || value.includes("//")) {
    throw new ValidationError("prefix must be a repository-relative path");
  }
  const segments = value.split("/");
  const meaningfulSegments = segments.filter((segment) => segment.length > 0);
  if (meaningfulSegments.some((segment) => segment === "." || segment === "..")) {
    throw new ValidationError("prefix must be a repository-relative path");
  }
  return meaningfulSegments.length === 0 ? "" : `${meaningfulSegments.join("/")}/`;
}

function repositoryObjectBrowserResponse(input: {
  repositoryName: string;
  prefix: string;
  listing: RepositoryObjectList;
}) {
  const basePrefix = `repositories/${input.repositoryName}/`;
  const relativePath = (key: string) => key.startsWith(basePrefix) ? key.slice(basePrefix.length) : key;
  const leafName = (path: string) => path.split("/").filter(Boolean).at(-1) ?? path;
  return {
    prefix: input.prefix,
    directories: input.listing.directories.map((directory) => {
      const path = relativePath(directory.path);
      return { name: leafName(path), path };
    }),
    objects: input.listing.objects.map((object) => {
      const path = relativePath(object.key);
      return {
        name: leafName(path),
        path,
        ...(object.contentLength !== undefined ? { size: object.contentLength } : {}),
        ...(object.contentType !== undefined ? { contentType: object.contentType } : {}),
        ...(object.etag !== undefined ? { etag: object.etag } : {}),
      };
    }),
    ...(input.listing.cursor !== undefined ? { cursor: input.listing.cursor } : {}),
    truncated: input.listing.truncated,
  };
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
  if (url.pathname === "/admin/session") {
    requireAdmin(request, dependencies.adminToken);
    if (request.method === "GET") {
      return jsonResponse({ ok: true });
    }
    throw new NotFoundError();
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
  if (url.pathname === "/admin/repository-plugins") {
    requireAdmin(request, dependencies.adminToken);
    if (request.method === "GET") {
      return jsonResponse({ plugins: await repositoryPluginMetadata(dependencies) });
    }
    throw new NotFoundError();
  }
  const adminRepositoryPluginEcosystem = parseAdminResourcePath(request.url, "repository-plugins");
  if (adminRepositoryPluginEcosystem) {
    requireAdmin(request, dependencies.adminToken);
    if (request.method === "PATCH") {
      if (
        !getRepositoryPluginCatalogEntry(adminRepositoryPluginEcosystem)
        && !dependencies.repositoryRuntimePlugins.getPlugin(adminRepositoryPluginEcosystem)
      ) {
        throw new NotFoundError(`Repository plugin not found: ${adminRepositoryPluginEcosystem}`);
      }
      const body = await readJsonObject(request);
      await dependencies.pluginPolicyService.setEnabledOverride(
        adminRepositoryPluginEcosystem,
        parseRepositoryPluginPolicyUpdate(body),
      );
      return jsonResponse(await repositoryPluginMetadataByEcosystem(dependencies, adminRepositoryPluginEcosystem));
    }
    throw new NotFoundError();
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
  const adminClientHelperPath = parseAdminRepositoryClientHelperPath(url.pathname);
  if (adminClientHelperPath && request.method === "GET") {
    requireAdmin(request, dependencies.adminToken);
    const repository = await dependencies.repositoryService.getByName(adminClientHelperPath.repositoryName);
    await ensureRepositoryPluginEnabled(dependencies, repository.ecosystem, () => new NotFoundError());
    const helpers = repositoryClientHelpers(dependencies, repository, adminClientHelperPath.namespace);
    if (!helpers || !repositoryClientHelperAction(helpers, adminClientHelperPath.action)) {
      throw new NotFoundError();
    }
    return dispatchRepositoryClientHelper(helpers, {
      repository,
      action: adminClientHelperPath.action,
      ...repositoryClientHelperContext(dependencies, url.origin),
    });
  }
  const adminRepositoryObjectsName = parseAdminRepositoryObjectsPath(url.pathname);
  if (adminRepositoryObjectsName) {
    requireAdmin(request, dependencies.adminToken);
    if (request.method !== "GET") {
      throw new NotFoundError();
    }
    const repository = await dependencies.repositoryService.getByName(adminRepositoryObjectsName);
    await ensureRepositoryPluginEnabled(dependencies, repository.ecosystem, () => new NotFoundError());
    const prefix = repositoryObjectListPrefix(url.searchParams.get("prefix"));
    const listing = await dependencies.repositoryObjectStore.listObjects({
      prefix: `repositories/${repository.name}/${prefix}`,
      delimiter: "/",
    });
    return jsonResponse(repositoryObjectBrowserResponse({
      repositoryName: repository.name,
      prefix,
      listing,
    }));
  }
  const adminPluginResourcePath = parseAdminRepositoryPluginResourcePath(request.url);
  if (adminPluginResourcePath) {
    requireAdmin(request, dependencies.adminToken);
    let repository: Repository | undefined;
    try {
      repository = await dependencies.repositoryService.getByName(adminPluginResourcePath.repositoryName);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
    }
    const plugin = repository
      ? dependencies.repositoryRuntimePlugins.getPlugin(repository.ecosystem)
      : dependencies.repositoryRuntimePlugins.getPluginByAdminResourceNamespace(adminPluginResourcePath.namespace);
    if (plugin) {
      await ensureRepositoryPluginEnabled(dependencies, plugin.ecosystem, () => new NotFoundError());
    }
    const adminResources = plugin?.adminResources;
    if (!adminResources || adminResources.namespace !== adminPluginResourcePath.namespace) {
      throw new NotFoundError();
    }
    return dispatchRepositoryAdminResource(adminResources, {
      repositoryName: adminPluginResourcePath.repositoryName,
      ...(repository ? { repository } : {}),
      request,
      path: adminPluginResourcePath.path,
      services: {
        secrets: dependencies.repositorySecrets,
      },
    });
  }
  if (url.pathname === "/admin/publish-sessions" && request.method === "GET") {
    requireAdmin(request, dependencies.adminToken);
    const sessions = await dependencies.publishSessionService.listAll();
    return jsonResponse({ sessions });
  }
  if (url.pathname === "/admin/publish-sessions" && request.method === "POST") {
    requireAdmin(request, dependencies.adminToken);
    const body = await readJsonObject(request);
    const artifacts = parseArtifacts(body);
    const session = await dependencies.publishSessionService.createAsAdmin({
      repositoryName: stringField(body, "repositoryName"),
      ecosystem: stringField(body, "ecosystem"),
      artifacts,
    });
    return jsonResponse(session, { status: 201 });
  }
  const adminVerifyUploadMatch = url.pathname.match(
    /^\/admin\/publish-sessions\/([^/]+)\/uploads\/([^/]+)\/verify$/,
  );
  if (adminVerifyUploadMatch && request.method === "POST") {
    requireAdmin(request, dependencies.adminToken);
    const [, sessionId, uploadId] = adminVerifyUploadMatch;
    if (!sessionId || !uploadId) {
      throw new NotFoundError();
    }
    const result = await dependencies.publishSessionService.verifyUploadAsAdmin({
      sessionId,
      uploadId,
    });
    return jsonResponse(result);
  }
  const localUploadMatch = url.pathname.match(/^\/api\/uploads\/([^/]+)\/([^/]+)$/);
  if (localUploadMatch && request.method === "PUT") {
    const localUploadBroker = dependencies.localUploadBroker;
    if (!localUploadBroker) {
      throw new NotFoundError();
    }
    const [, sessionId, uploadId] = localUploadMatch;
    if (!sessionId || !uploadId) {
      throw new NotFoundError();
    }
    const session = await dependencies.publishSessionService.getAsAdmin({ sessionId });
    const target = session.uploads.find((upload) => upload.uploadId === uploadId);
    if (!target) {
      throw new NotFoundError(`Upload not found: ${uploadId}`);
    }
    const contentType = request.headers.get("content-type");
    await localUploadBroker.putUpload({
      target,
      body: new Uint8Array(await request.arrayBuffer()),
      ...(contentType ? { contentType } : {}),
    });
    return new Response(null, { status: 204 });
  }
  const adminFinalizeMatch = url.pathname.match(/^\/admin\/publish-sessions\/([^/]+)\/finalize$/);
  if (adminFinalizeMatch && request.method === "POST") {
    requireAdmin(request, dependencies.adminToken);
    const [, sessionId] = adminFinalizeMatch;
    if (!sessionId) {
      throw new NotFoundError();
    }
    const result = await dependencies.publishSessionService.finalizeAsAdmin({
      sessionId,
    });
    return jsonResponse(result);
  }
  if (url.pathname === "/api/publish-sessions" && request.method === "GET") {
    const secret = requireBearer(request);
    const principal = await dependencies.publishTokenService.verify(secret);
    const sessions = await dependencies.publishSessionService.list({ principal });
    return jsonResponse({ sessions });
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
  const getPublishSessionMatch = url.pathname.match(/^\/api\/publish-sessions\/([^/]+)$/);
  if (getPublishSessionMatch && request.method === "GET") {
    const [, sessionId] = getPublishSessionMatch;
    if (!sessionId) {
      throw new NotFoundError();
    }
    const secret = requireBearer(request);
    const principal = await dependencies.publishTokenService.verify(secret);
    const session = await dependencies.publishSessionService.get({ sessionId, principal });
    return jsonResponse({ session });
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
  const clientHelperPath = parseRepositoryClientHelperPath(request.url);
  if (clientHelperPath && request.method === "GET") {
    const repository = await dependencies.repositoryService.getByName(clientHelperPath.repositoryName);
    await ensureRepositoryPluginEnabled(dependencies, repository.ecosystem, () => new NotFoundError());
    const helpers = repositoryClientHelpers(dependencies, repository, clientHelperPath.namespace);
    if (helpers) {
      const action = repositoryClientHelperAction(helpers, clientHelperPath.action);
      if (!action) {
        throw new NotFoundError();
      }
      if (!action.public) {
        await authorizeRepositoryRead(request, dependencies, repository);
      }
      return dispatchRepositoryClientHelper(helpers, {
        repository,
        action: clientHelperPath.action,
        ...repositoryClientHelperContext(dependencies, url.origin),
      });
    }
  }
  const repositoryObjectPath = parseRepositoryObjectPath(request.url);
  if (repositoryObjectPath && (request.method === "GET" || request.method === "HEAD")) {
    const { repositoryName, relativePath } = repositoryObjectPath;
    const repository = await dependencies.repositoryService.getByName(repositoryName);
    await ensureRepositoryPathIsServable(dependencies, repository, relativePath);
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
    const uiResponse = adminUiResponse(url.pathname, dependencies);
    if (uiResponse) {
      return uiResponse;
    }
  }
  throw new NotFoundError();
}
