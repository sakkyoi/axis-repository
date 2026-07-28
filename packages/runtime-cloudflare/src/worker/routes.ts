import {
  AxisError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
  principalRefFromAdminPrincipal,
  type PublishArtifactRequest,
  type PublishSession,
  type UploadTarget,
  type PublishTokenRecord,
  type AdminUserRecord,
  type Repository,
  type RepositoryVisibility,
  type RepositoryObject,
  type RepositoryObjectList,
  type RepositoryObjectMetadata,
  type RepositoryObjectRange,
} from "@axis-repository/core";
import { getRepositoryPluginCatalogEntry, repositoryPluginCatalog } from "@axis-repository/plugin-catalog";
import { adminUiAssets, injectAdminUiRuntimeConfig, type AdminUiAsset } from "../admin-ui-assets";
import type { AppDependencies } from "./dev-dependencies";
import { isStringArray, optionalObjectField, readJsonObject, requireAdmin, requireBasicAuthSecret, requireBearer, stringArrayField, stringField } from "../http";
import {
  ensureRepositoryPluginEnabled as ensureEffectiveRepositoryPluginEnabled,
  repositoryPluginPolicyFields,
} from "../plugins/repository-plugin-policy";
import { dispatchRepositoryAdminResource } from "../plugins/repository-plugin-admin-resources";
import { scopeSecretsToEcosystem } from "../plugins/scoped-capabilities";
import { dispatchRepositoryClientHelper } from "../plugins/repository-plugin-client-helpers";
import { adminRefreshCookie, clearAdminRefreshCookie, refreshTokenFromCookie, requestIsSecure } from "../auth/admin-auth";

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

/**
 * Upload targets carry presigned URLs and signed headers, so they are bearer
 * capabilities for writing to storage. They are handed out once when the
 * session is created; every later read of the session redacts them, along with
 * the authorization detail of the principal that created it. Otherwise any
 * token scoped to the same repository could read a peer's in-flight capability.
 */
function readablePublishSession(session: PublishSession) {
  return {
    ...session,
    requestedBy: {
      tokenId: session.requestedBy.tokenId,
      name: session.requestedBy.name,
      ...(session.requestedBy.owner ? { owner: { ...session.requestedBy.owner } } : {}),
    },
    uploads: session.uploads.map(({ url, headers, ...upload }) => upload),
  };
}

function publicAdminUser(record: AdminUserRecord): Omit<AdminUserRecord, "passwordHash"> {
  const { passwordHash, ...publicRecord } = record;
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
  if (!isStringArray(value) || value.some((item) => !item.trim())) {
    throw new ValidationError(`${key} must be an array of strings`);
  }
  return [...value];
}

/** Upper bound on a declared artifact size; also the same-origin upload ceiling. */
const MAX_ARTIFACT_SIZE_BYTES = 5 * 1024 * 1024 * 1024;

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
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) {
    throw new ValidationError(`artifacts[${index}].size must be a non-negative integer`);
  }
  if (size > MAX_ARTIFACT_SIZE_BYTES) {
    throw new ValidationError(
      `artifacts[${index}].size must be at most ${MAX_ARTIFACT_SIZE_BYTES} bytes`,
    );
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

// Repository objects carry publisher-controlled bytes and a publisher-controlled
// content-type, and they are served from the same origin as the admin UI. Stop
// the browser from ever treating them as active content.
function applyRepositoryObjectHardening(headers: Headers): Headers {
  headers.set("x-content-type-options", "nosniff");
  headers.set("content-disposition", "attachment");
  headers.set("content-security-policy", "default-src 'none'; sandbox");
  return headers;
}

function objectHeaders(input: {
  metadata: RepositoryObjectMetadata;
  contentLength?: number;
  cacheControl: string;
  range?: ParsedRange;
}): Headers {
  const headers = applyRepositoryObjectHardening(new Headers());
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
  const headers = applyRepositoryObjectHardening(new Headers());
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

/**
 * Nonce-only script policy.
 *
 * `'self'` is deliberately absent: repository objects are served from this same
 * origin with a publisher-controlled content type, so a host source would let
 * an uploaded artifact be loaded as a script by any injection. `strict-dynamic`
 * makes browsers ignore host sources entirely and trust only what an already
 * trusted script loads, which also covers route chunks the build may add later.
 */
function adminUiContentSecurityPolicy(nonce: string, uploadOrigin?: string): string {
  // Presigned uploads go straight from the browser to the storage host. Naming
  // that one origin keeps connect-src from having to allow all of https:, which
  // would otherwise be an open exfiltration channel after any injection.
  const connectSources = ["'self'", ...(uploadOrigin ? [uploadOrigin] : [])];
  return [
    "default-src 'self'",
    `script-src 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    `connect-src ${connectSources.join(" ")}`,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
  ].join("; ");
}

function adminUiAssetResponse(asset: AdminUiAsset, dependencies: AppDependencies): Response {
  const isHtml = asset.contentType.startsWith("text/html");
  if (!isHtml) {
    return new Response(asset.body, {
      headers: {
        "content-type": asset.contentType,
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  }
  const nonce = crypto.randomUUID().replaceAll("-", "");
  return new Response(
    injectAdminUiRuntimeConfig(asset.body, dependencies.adminUiRuntimeConfig, nonce),
    {
      headers: {
        "content-type": asset.contentType,
        "cache-control": "no-store",
        "content-security-policy": adminUiContentSecurityPolicy(
          nonce,
          dependencies.adminUiRuntimeConfig.uploadOrigin,
        ),
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

/** A decoded path segment must be non-empty and must not be a traversal step. */
function requireSafePathSegment(segment: string): string {
  const decoded = decodePathSegment(segment);
  if (!decoded || decoded === "." || decoded === "..") {
    throw new NotFoundError();
  }
  return decoded;
}

/**
 * Matches `pathname` against an admin repository route and returns the decoded
 * captures, or null when the route does not apply.
 */
function matchAdminRepositoryPath(pathname: string, pattern: RegExp): string[] | null {
  const match = pathname.match(pattern);
  if (!match) return null;
  return match.slice(1).map((segment) => requireSafePathSegment(segment ?? ""));
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
  // A single trailing slash is kept rather than rejected: a format that serves
  // directory indexes distinguishes `simple/` from `simple`. Any other empty
  // segment is still refused, so `a//b` stays out.
  const trailingSlash = rawSegments[rawSegments.length - 1] === "";
  const namedSegments = trailingSlash ? rawSegments.slice(0, -1) : rawSegments;
  if (namedSegments.length < 2) {
    return null;
  }
  const decodedSegments = namedSegments.map(requireSafePathSegment);
  const [repositoryName, ...relativeSegments] = decodedSegments;
  if (!repositoryName || relativeSegments.length === 0) {
    return null;
  }
  return {
    repositoryName,
    relativePath: `${relativeSegments.join("/")}${trailingSlash ? "/" : ""}`,
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
  return requireSafePathSegment(rawSegments[0] ?? "");
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
  return requireSafePathSegment(rawSegments[0] ?? "");
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
  // An empty segment means this is not a helper route: `simple/` has the same
  // shape as `<namespace>/<action>` but is a directory the object route
  // serves, and claiming it here would answer that request with a 404.
  if (rawSegments.length !== 3 || rawSegments.some((segment) => segment === "")) {
    return null;
  }
  const [rawRepositoryName, rawNamespace, rawAction] = rawSegments;
  return {
    repositoryName: requireSafePathSegment(rawRepositoryName ?? ""),
    namespace: requireSafePathSegment(rawNamespace ?? ""),
    action: requireSafePathSegment(rawAction ?? ""),
  };
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

async function deleteRepositoryObjectPrefix(dependencies: AppDependencies, repositoryName: string): Promise<number> {
  const prefix = `repositories/${repositoryName}/`;
  let deleted = 0;
  for (;;) {
    const listing = await dependencies.repositoryObjectStore.listObjects({
      prefix,
    });
    if (listing.objects.length === 0) {
      return deleted;
    }
    let deletedThisPage = 0;
    for (const object of listing.objects) {
      if (await dependencies.repositoryObjectStore.deleteObject(object.key)) {
        deleted++;
        deletedThisPage++;
      }
    }
    if (!listing.truncated || deletedThisPage === 0) {
      return deleted;
    }
  }
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
  const segments = matchAdminRepositoryPath(pathname, ADMIN_REPOSITORY_ROUTES.clientHelper);
  if (!segments) return null;
  return { repositoryName: segments[0]!, namespace: segments[1]!, action: segments[2]! };
}






const ADMIN_REPOSITORY_ROUTES = {
  objects: /^\/admin\/repositories\/([^/]+)\/objects$/,
  objectDetail: /^\/admin\/repositories\/([^/]+)\/objects\/detail$/,
  activity: /^\/admin\/repositories\/([^/]+)\/activity$/,
  artifacts: /^\/admin\/repositories\/([^/]+)\/artifacts$/,
  artifactsRebuildIndex: /^\/admin\/repositories\/([^/]+)\/artifacts\/rebuild-index$/,
  artifact: /^\/admin\/repositories\/([^/]+)\/artifacts\/([^/]+)$/,
  clientHelper: /^\/admin\/repositories\/([^/]+)\/([^/]+)\/client\/([^/]+)$/,
} as const;

function adminRepositoryNameFor(pathname: string, pattern: RegExp): string | null {
  return matchAdminRepositoryPath(pathname, pattern)?.[0] ?? null;
}

function parseAdminRepositoryArtifactPath(pathname: string): {
  repositoryName: string;
  artifactId: string;
} | null {
  const segments = matchAdminRepositoryPath(pathname, ADMIN_REPOSITORY_ROUTES.artifact);
  if (!segments) return null;
  return { repositoryName: segments[0]!, artifactId: segments[1]! };
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
  return {
    repositoryName: requireSafePathSegment(rawRepositoryName ?? ""),
    namespace: requireSafePathSegment(rawNamespace ?? ""),
    path: rawPathSegments.map(requireSafePathSegment),
  };
}

/**
 * Decides whether a path may be served, and which object answers it.
 *
 * A plugin that addresses its objects directly resolves to the path itself.
 * One whose URLs are not object keys — the Simple API's `simple/foo/` — maps
 * them here, and what it returns is checked the same way a request path is,
 * so a plugin cannot resolve its way out of the repository.
 */
async function resolveServedRepositoryPath(
  dependencies: AppDependencies,
  repository: Repository,
  context: { relativePath: string; accept?: string },
): Promise<{ objectPath: string; contentType?: string }> {
  await ensureRepositoryPluginEnabled(dependencies, repository.ecosystem, () => new NotFoundError());
  const plugin = dependencies.repositoryRuntimePlugins.getPlugin(repository.ecosystem);
  if (!plugin?.canServeRepositoryPath(context)) {
    throw new NotFoundError();
  }

  const resolved = plugin.resolveRepositoryPath?.(context)
    ?? { objectPath: context.relativePath };
  return { ...resolved, objectPath: requireSafeRelativePath(resolved.objectPath) };
}

/**
 * Publishes through an ecosystem's own upload protocol.
 *
 * `twine` sends one request where the publish-session API takes four, so this
 * runs the same four steps on the caller's behalf: the session is created,
 * written to, verified and finalized exactly as any other client's would be,
 * and so gets the same validation, the same write lock and the same indexes.
 *
 * Returns null when the path is not this repository's protocol endpoint, so
 * the caller can go on matching other routes.
 */
async function handleProtocolUpload(
  dependencies: AppDependencies,
  request: Request,
  path: { repositoryName: string; relativePath: string },
): Promise<Response | null> {
  const repository = await dependencies.repositoryService.getByName(path.repositoryName).catch(() => null);
  if (!repository) {
    return null;
  }
  const protocol = dependencies.repositoryRuntimePlugins.getPlugin(repository.ecosystem)?.uploadProtocol;
  if (!protocol || path.relativePath.replace(/\/+$/, "") !== protocol.path) {
    return null;
  }

  await ensureRepositoryPluginEnabled(dependencies, repository.ecosystem, () => new NotFoundError());
  const principal = await dependencies.publishTokenService.verify(requireBasicAuthSecret(request));
  const uploads = await protocol.parseUpload(request);
  if (uploads.length === 0) {
    throw new ValidationError("Upload does not carry an artifact");
  }

  const localUploadBroker = dependencies.localUploadBroker;
  if (!localUploadBroker) {
    throw new NotFoundError();
  }

  const session = await dependencies.publishSessionService.create({
    repositoryName: repository.name,
    ecosystem: repository.ecosystem,
    principal,
    artifacts: uploads.map((upload) => upload.artifact),
  });

  for (const [index, upload] of uploads.entries()) {
    const target = session.uploads[index];
    if (!target) {
      throw new ValidationError("Upload was not paired with a staging target");
    }
    await localUploadBroker.putUpload({
      target,
      body: upload.body,
      contentType: upload.artifact.contentType,
    });
    await dependencies.publishSessionService.verifyUpload({
      sessionId: session.id,
      uploadId: target.uploadId,
      principal,
    });
  }

  await dependencies.publishSessionService.finalize({ sessionId: session.id, principal });
  return protocol.successResponse?.() ?? new Response(null, { status: 200 });
}

function requireSafeRelativePath(objectPath: string): string {
  const segments = objectPath.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new NotFoundError();
  }
  return segments.join("/");
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

function repositoryObjectRelativePathParam(value: string | null): string {
  if (!value || value.startsWith("/") || value.includes("\\") || value.includes("//")) {
    throw new ValidationError("path must be a repository-relative object path");
  }
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new ValidationError("path must be a repository-relative object path");
  }
  return segments.join("/");
}

function publishSessionActivity(session: PublishSession) {
  const artifactLabel = session.artifacts.length === 1 ? "artifact" : "artifacts";
  return {
    id: `publish:${session.id}`,
    repositoryName: session.repositoryName,
    type: "publish",
    actor: "publish-token",
    summary: `Published ${session.artifacts.length} ${artifactLabel}`,
    metadata: {},
    createdAt: session.createdAt,
    session: readablePublishSession(session),
  };
}

async function repositoryActivityTimeline(dependencies: AppDependencies, repositoryName: string) {
  const storedActivities = await dependencies.repositoryActivityService.listByRepository(repositoryName);
  const publishActivities = (await dependencies.publishSessionService.listAll())
    .filter((session) => session.repositoryName === repositoryName)
    .map(publishSessionActivity);
  return [...storedActivities, ...publishActivities].sort((left, right) => {
    const createdAtOrder = right.createdAt.localeCompare(left.createdAt);
    return createdAtOrder === 0 ? left.id.localeCompare(right.id) : createdAtOrder;
  });
}

interface RepositoryActivityPageParams {
  limit: number;
  offset: number;
}

const DEFAULT_ACTIVITY_PAGE_LIMIT = 10;
const MAX_ACTIVITY_PAGE_LIMIT = 100;

function repositoryActivityPageParams(searchParams: URLSearchParams): RepositoryActivityPageParams {
  const limitParam = searchParams.get("limit");
  const limit = limitParam === null ? DEFAULT_ACTIVITY_PAGE_LIMIT : Number(limitParam);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ACTIVITY_PAGE_LIMIT) {
    throw new ValidationError(`limit must be an integer between 1 and ${MAX_ACTIVITY_PAGE_LIMIT}`);
  }
  const cursor = searchParams.get("cursor");
  return {
    limit,
    offset: cursor ? decodeActivityCursor(cursor) : 0,
  };
}

function repositoryActivityPage<T>(activities: T[], params: RepositoryActivityPageParams) {
  const end = params.offset + params.limit;
  const pageActivities = activities.slice(params.offset, end);
  const truncated = end < activities.length;
  return {
    activities: pageActivities,
    truncated,
    ...(truncated ? { cursor: encodeActivityCursor(end) } : {}),
  };
}

function encodeActivityCursor(offset: number): string {
  return btoa(JSON.stringify({ offset }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function decodeActivityCursor(cursor: string): number {
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

function repositoryObjectDetailResponse(input: {
  origin: string;
  repositoryName: string;
  path: string;
  objectKey: string;
  metadata: RepositoryObjectMetadata;
}) {
  const leafName = input.path.split("/").filter(Boolean).at(-1) ?? input.path;
  return {
    object: {
      name: leafName,
      path: input.path,
      objectKey: input.objectKey,
      repositoryUrl: `${input.origin}/repositories/${encodeURIComponent(input.repositoryName)}/${input.path.split("/").map(encodeURIComponent).join("/")}`,
      ...(input.metadata.contentLength !== undefined ? { size: input.metadata.contentLength } : {}),
      ...(input.metadata.contentType !== undefined ? { contentType: input.metadata.contentType } : {}),
      ...(input.metadata.etag !== undefined ? { etag: input.metadata.etag } : {}),
    },
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

// Unlike a presigned storage URL, a same-origin upload target carries no
// embedded expiry, so the session state is the only thing bounding it. Without
// these checks the URL stays a usable write capability forever, and the body is
// read into memory before anything compares it to the declared artifact size.
function ensureUploadTargetIsWritable(session: PublishSession, target: UploadTarget): void {
  // Legacy sessions persisted "created" for what is now "pending_uploads";
  // PublishSessionService normalizes the same way.
  const persistedStatus = session.status as PublishSession["status"] | "created";
  const status = persistedStatus === "created" ? "pending_uploads" : persistedStatus;
  // Only before verification. Once a session is "ready" its uploads have been
  // checksummed, and finalize trusts those recorded digests rather than
  // re-reading the bytes, so a later write would publish content that does not
  // match the signed index.
  if (status !== "pending_uploads") {
    throw new ValidationError(`Publish session is not open: ${session.status}`);
  }
  const now = Date.now();
  const sessionExpiresAt = Date.parse(session.expiresAt);
  const targetExpiresAt = Date.parse(target.expiresAt);
  // An unreadable timestamp means the bound is unknown, which must not read as
  // "no bound".
  if (!Number.isFinite(sessionExpiresAt) || sessionExpiresAt <= now) {
    throw new ValidationError("Publish session has expired");
  }
  if (!Number.isFinite(targetExpiresAt) || targetExpiresAt <= now) {
    throw new ValidationError("Upload target has expired");
  }
}

/**
 * Reads at most `expectedSize` bytes, incrementally.
 *
 * A declared content-length is only a hint: a chunked request omits it
 * entirely. Buffering the whole body first and checking afterwards would let
 * any caller stream unbounded data into the Durable Object, so the limit is
 * enforced as the stream is consumed.
 */
async function readUploadBody(request: Request, expectedSize: number): Promise<Uint8Array> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new ValidationError("content-length must be a non-negative integer");
    }
    if (length > expectedSize) {
      throw new ValidationError("Uploaded object is larger than the declared artifact size");
    }
  }

  const body = request.body;
  if (!body) {
    return new Uint8Array(0);
  }
  const reader = (body as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      received += next.value.byteLength;
      if (received > expectedSize) {
        throw new ValidationError("Uploaded object is larger than the declared artifact size");
      }
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Which half of the service this hostname answers for.
 *
 * With no artifact origin configured a single origin serves everything, which
 * is the default. Configuring one splits them: publisher-controlled bytes stop
 * sharing an origin with the admin UI, so a future injection there cannot reach
 * for them as a same-origin resource.
 */
function originRoles(url: URL, dependencies: AppDependencies): {
  servesArtifacts: boolean;
  servesAdmin: boolean;
} {
  const artifactOrigin = dependencies.artifactOrigin;
  if (!artifactOrigin) {
    return { servesArtifacts: true, servesAdmin: true };
  }
  const isArtifactOrigin = url.origin === artifactOrigin;
  return { servesArtifacts: isArtifactOrigin, servesAdmin: !isArtifactOrigin };
}

/** Origin to advertise in client-facing URLs (apt sources, pip index, links). */
function publicArtifactOrigin(url: URL, dependencies: AppDependencies): string {
  return dependencies.artifactOrigin ?? url.origin;
}

export async function dispatch(request: Request, dependencies: AppDependencies): Promise<Response> {
  const url = new URL(request.url);
  const { servesArtifacts, servesAdmin } = originRoles(url, dependencies);
  if (url.pathname === "/health") {
    return jsonResponse({ ok: true, service: "axis-repository" });
  }
  if (!servesAdmin && !url.pathname.startsWith("/repositories/")) {
    throw new NotFoundError();
  }
  if (url.pathname === "/admin/auth/login") {
    if (request.method !== "POST") {
      throw new NotFoundError();
    }
    const body = await readJsonObject(request);
    const result = await dependencies.adminAuthService.login({
      username: stringField(body, "username"),
      password: stringField(body, "password"),
    });
    return jsonResponse(
      {
        accessToken: result.accessToken,
        accessTokenExpiresAt: result.accessTokenExpiresAt,
        principal: result.principal,
      },
      {
        headers: {
          "set-cookie": adminRefreshCookie({
            refreshToken: result.refreshToken,
            expiresAt: result.refreshTokenExpiresAt,
            secure: requestIsSecure(request),
          }),
        },
      },
    );
  }
  if (url.pathname === "/admin/auth/refresh") {
    if (request.method !== "POST") {
      throw new NotFoundError();
    }
    const refreshToken = refreshTokenFromCookie(request);
    if (!refreshToken) {
      throw new UnauthorizedError();
    }
    const result = await dependencies.adminAuthService.refresh(refreshToken);
    return jsonResponse(
      {
        accessToken: result.accessToken,
        accessTokenExpiresAt: result.accessTokenExpiresAt,
        principal: result.principal,
      },
      {
        headers: {
          "set-cookie": adminRefreshCookie({
            refreshToken: result.refreshToken,
            expiresAt: result.refreshTokenExpiresAt,
            secure: requestIsSecure(request),
          }),
        },
      },
    );
  }
  if (url.pathname === "/admin/auth/logout") {
    if (request.method !== "POST") {
      throw new NotFoundError();
    }
    const refreshToken = refreshTokenFromCookie(request);
    if (refreshToken) {
      // An already-expired or already-revoked session still has to clear the
      // cookie, or the browser keeps presenting a dead token forever.
      await dependencies.adminAuthService.logout(refreshToken).catch(() => undefined);
    }
    return new Response(null, { status: 204, headers: { "set-cookie": clearAdminRefreshCookie(requestIsSecure(request)) } });
  }
  if (url.pathname === "/admin/auth/change-password") {
    if (request.method !== "POST") {
      throw new NotFoundError();
    }
    const principal = await requireAdmin(request, dependencies.adminAuthService);
    const body = await readJsonObject(request);
    await dependencies.adminAuthService.changeOwnPassword(principal, {
      currentPassword: stringField(body, "currentPassword"),
      newPassword: stringField(body, "newPassword"),
    });
    return new Response(null, { status: 204, headers: { "set-cookie": clearAdminRefreshCookie(requestIsSecure(request)) } });
  }
  if (url.pathname === "/admin/session") {
    if (request.method === "GET") {
      const token = requireBearer(request);
      return jsonResponse({
        ok: true,
        principal: await dependencies.adminAuthService.verifyAccessToken(token),
      });
    }
    throw new NotFoundError();
  }
  if (url.pathname === "/admin/users") {
    await requireAdmin(request, dependencies.adminAuthService);
    if (request.method === "GET") {
      return jsonResponse({
        users: (await dependencies.adminAuthService.listUsers()).map(publicAdminUser),
        canCreateUsers: false,
      });
    }
    if (request.method === "POST") {
      return jsonResponse(
        { error: { code: "not_implemented", message: "Admin user creation is coming soon" } },
        { status: 501 },
      );
    }
    throw new NotFoundError();
  }
  if (url.pathname === "/admin/repositories") {
    await requireAdmin(request, dependencies.adminAuthService);
    if (request.method === "GET") {
      return jsonResponse({ repositories: await dependencies.repositoryService.list() });
    }
    if (request.method === "POST") {
      const body = await readJsonObject(request);
      const provisioning = optionalObjectField(body, "provisioning");
      const repository = await dependencies.repositoryService.create({
        name: stringField(body, "name"),
        ecosystem: stringField(body, "ecosystem"),
        visibility: repositoryVisibility(body),
        config: optionalObjectField(body, "config") ?? {},
        ...(provisioning === undefined ? {} : { provisioning }),
      });
      return jsonResponse(repository, { status: 201 });
    }
  }
  if (url.pathname === "/admin/repository-plugins") {
    await requireAdmin(request, dependencies.adminAuthService);
    if (request.method === "GET") {
      return jsonResponse({ plugins: await repositoryPluginMetadata(dependencies) });
    }
    throw new NotFoundError();
  }
  const adminRepositoryPluginEcosystem = parseAdminResourcePath(request.url, "repository-plugins");
  if (adminRepositoryPluginEcosystem) {
    await requireAdmin(request, dependencies.adminAuthService);
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
    await requireAdmin(request, dependencies.adminAuthService);
    if (request.method === "GET") {
      return jsonResponse(await dependencies.repositoryService.getByName(adminRepositoryName));
    }
    if (request.method === "PATCH") {
      const body = await readJsonObject(request);
      return jsonResponse(
        await dependencies.repositoryService.update(adminRepositoryName, parseRepositoryUpdate(body)),
      );
    }
    if (request.method === "DELETE") {
      await dependencies.repositoryService.getByName(adminRepositoryName);
      await deleteRepositoryObjectPrefix(dependencies, adminRepositoryName);
      await dependencies.repositoryService.delete(adminRepositoryName);
      return new Response(null, { status: 204 });
    }
    throw new NotFoundError();
  }
  if (url.pathname === "/admin/publish-tokens") {
    const adminPrincipal = await requireAdmin(request, dependencies.adminAuthService);
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
        owner: principalRefFromAdminPrincipal(adminPrincipal),
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
    await requireAdmin(request, dependencies.adminAuthService);
    if (request.method !== "POST") {
      throw new NotFoundError();
    }
    return jsonResponse(publicPublishToken(await dependencies.publishTokenService.revoke(revokePublishTokenName)));
  }
  const rotatePublishTokenName = parseAdminResourceActionPath(request.url, "publish-tokens", "rotate");
  if (rotatePublishTokenName) {
    await requireAdmin(request, dependencies.adminAuthService);
    if (request.method !== "POST") {
      throw new NotFoundError();
    }
    const result = await dependencies.publishTokenService.rotate(rotatePublishTokenName);
    return jsonResponse({
      token: publicPublishToken(result.record),
      secret: result.secret,
    });
  }
  const adminPublishTokenName = parseAdminResourcePath(request.url, "publish-tokens");
  if (adminPublishTokenName) {
    await requireAdmin(request, dependencies.adminAuthService);
    if (request.method === "GET") {
      return jsonResponse(publicPublishToken(await dependencies.publishTokenService.getByName(adminPublishTokenName)));
    }
    if (request.method === "DELETE") {
      await dependencies.publishTokenService.delete(adminPublishTokenName);
      return new Response(null, { status: 204 });
    }
    throw new NotFoundError();
  }
  const adminClientHelperPath = parseAdminRepositoryClientHelperPath(url.pathname);
  if (adminClientHelperPath && request.method === "GET") {
    await requireAdmin(request, dependencies.adminAuthService);
    const repository = await dependencies.repositoryService.getByName(adminClientHelperPath.repositoryName);
    await ensureRepositoryPluginEnabled(dependencies, repository.ecosystem, () => new NotFoundError());
    const helpers = repositoryClientHelpers(dependencies, repository, adminClientHelperPath.namespace);
    if (!helpers || !repositoryClientHelperAction(helpers, adminClientHelperPath.action)) {
      throw new NotFoundError();
    }
    return dispatchRepositoryClientHelper(helpers, {
      repository,
      action: adminClientHelperPath.action,
      // Served on the admin origin, but the sources.list line and index URL it
      // produces must point at wherever artifacts are actually served.
      origin: publicArtifactOrigin(url, dependencies),
    });
  }
  const adminRepositoryActivityName = adminRepositoryNameFor(url.pathname, ADMIN_REPOSITORY_ROUTES.activity);
  if (adminRepositoryActivityName) {
    await requireAdmin(request, dependencies.adminAuthService);
    if (request.method !== "GET") {
      throw new NotFoundError();
    }
    const repository = await dependencies.repositoryService.getByName(adminRepositoryActivityName);
    await ensureRepositoryPluginEnabled(dependencies, repository.ecosystem, () => new NotFoundError());
    return jsonResponse(repositoryActivityPage(
      await repositoryActivityTimeline(dependencies, repository.name),
      repositoryActivityPageParams(url.searchParams),
    ));
  }
  const adminRepositoryArtifactsName = adminRepositoryNameFor(url.pathname, ADMIN_REPOSITORY_ROUTES.artifacts);
  if (adminRepositoryArtifactsName) {
    await requireAdmin(request, dependencies.adminAuthService);
    if (request.method !== "GET") {
      throw new NotFoundError();
    }
    const repository = await dependencies.repositoryService.getByName(adminRepositoryArtifactsName);
    await ensureRepositoryPluginEnabled(dependencies, repository.ecosystem, () => new NotFoundError());
    return jsonResponse({
      artifacts: await dependencies.repositoryArtifactStore.listByRepository(repository.name),
      truncated: false,
    });
  }
  const adminRepositoryArtifactsRebuildName = adminRepositoryNameFor(url.pathname, ADMIN_REPOSITORY_ROUTES.artifactsRebuildIndex);
  if (adminRepositoryArtifactsRebuildName) {
    await requireAdmin(request, dependencies.adminAuthService);
    if (request.method !== "POST") {
      throw new NotFoundError();
    }
    const repository = await dependencies.repositoryService.getByName(adminRepositoryArtifactsRebuildName);
    await ensureRepositoryPluginEnabled(dependencies, repository.ecosystem, () => new NotFoundError());
    const result = await dependencies.repositoryArtifactIndexService.rebuild({ repositoryName: repository.name });
    await dependencies.repositoryActivityService.recordArtifactIndexRebuild({
      repositoryName: repository.name,
      artifactCount: result.artifacts.length,
    });
    return jsonResponse({ ...result, truncated: false });
  }
  const adminRepositoryArtifactPath = parseAdminRepositoryArtifactPath(url.pathname);
  if (adminRepositoryArtifactPath) {
    await requireAdmin(request, dependencies.adminAuthService);
    if (request.method !== "DELETE") {
      throw new NotFoundError();
    }
    const repository = await dependencies.repositoryService.getByName(adminRepositoryArtifactPath.repositoryName);
    await ensureRepositoryPluginEnabled(dependencies, repository.ecosystem, () => new NotFoundError());
    const result = await dependencies.repositoryArtifactIndexService.deleteArtifact({
      repositoryName: repository.name,
      artifactId: adminRepositoryArtifactPath.artifactId,
    });
    const activity = await dependencies.repositoryActivityService.recordArtifactDelete({
      repositoryName: repository.name,
      artifactId: result.artifact.id,
      identity: result.artifact.identity,
      summary: result.artifact.summary,
      name: result.artifact.name,
      ...(result.artifact.version !== undefined ? { version: result.artifact.version } : {}),
      objectKeys: result.artifact.objectKeys,
      deletedObjectKeys: result.deletedObjectKeys,
      missingObjectKeys: result.missingObjectKeys,
      skippedObjectKeys: result.skippedObjectKeys,
      failedObjectKeys: result.failedObjectKeys,
    });
    await dependencies.repositoryActivityService.recordArtifactIndexRebuild({
      repositoryName: repository.name,
      artifactCount: result.artifacts.length,
    });
    const { artifact, artifacts, ...deleteResult } = result;
    return jsonResponse({ activity, artifact, artifacts, ...deleteResult, truncated: false });
  }
  const adminRepositoryObjectDetailName = adminRepositoryNameFor(url.pathname, ADMIN_REPOSITORY_ROUTES.objectDetail);
  if (adminRepositoryObjectDetailName) {
    await requireAdmin(request, dependencies.adminAuthService);
    if (request.method !== "GET") {
      throw new NotFoundError();
    }
    const repository = await dependencies.repositoryService.getByName(adminRepositoryObjectDetailName);
    await ensureRepositoryPluginEnabled(dependencies, repository.ecosystem, () => new NotFoundError());
    const relativePath = repositoryObjectRelativePathParam(url.searchParams.get("path"));
    const objectKey = `repositories/${repository.name}/${relativePath}`;
    const metadata = await dependencies.repositoryObjectStore.headObject(objectKey);
    if (!metadata) {
      throw new NotFoundError();
    }
    return jsonResponse(repositoryObjectDetailResponse({
      origin: publicArtifactOrigin(url, dependencies),
      repositoryName: repository.name,
      path: relativePath,
      objectKey,
      metadata,
    }));
  }
  const adminRepositoryObjectsName = adminRepositoryNameFor(url.pathname, ADMIN_REPOSITORY_ROUTES.objects);
  if (adminRepositoryObjectsName) {
    await requireAdmin(request, dependencies.adminAuthService);
    const repository = await dependencies.repositoryService.getByName(adminRepositoryObjectsName);
    await ensureRepositoryPluginEnabled(dependencies, repository.ecosystem, () => new NotFoundError());
    if (request.method === "GET") {
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
    if (request.method === "DELETE") {
      const relativePath = repositoryObjectRelativePathParam(url.searchParams.get("path"));
      const objectKey = `repositories/${repository.name}/${relativePath}`;
      const metadata = await dependencies.repositoryObjectStore.headObject(objectKey);
      if (!metadata) {
        throw new NotFoundError();
      }
      const deleted = await dependencies.repositoryObjectStore.deleteObject(objectKey);
      if (!deleted) {
        throw new NotFoundError();
      }
      const activity = await dependencies.repositoryActivityService.recordObjectDelete({
        repositoryName: repository.name,
        path: relativePath,
        objectKey,
        ...(metadata.contentType !== undefined ? { contentType: metadata.contentType } : {}),
        ...(metadata.contentLength !== undefined ? { size: metadata.contentLength } : {}),
      });
      const rebuildResult = await dependencies.repositoryArtifactIndexService.rebuild({ repositoryName: repository.name });
      await dependencies.repositoryActivityService.recordArtifactIndexRebuild({
        repositoryName: repository.name,
        artifactCount: rebuildResult.artifacts.length,
      });
      return jsonResponse({ activity });
    }
    throw new NotFoundError();
  }
  const adminPluginResourcePath = parseAdminRepositoryPluginResourcePath(request.url);
  if (adminPluginResourcePath) {
    await requireAdmin(request, dependencies.adminAuthService);
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
        // Same scoping the plugin gets at construction. Handing over the raw
        // service here would let any plugin that reads services.secrets reach
        // every namespace and decrypt other plugins' secrets.
        secrets: scopeSecretsToEcosystem(dependencies.repositorySecrets, plugin.ecosystem),
      },
    });
  }
  if (url.pathname === "/admin/publish-sessions" && request.method === "GET") {
    await requireAdmin(request, dependencies.adminAuthService);
    const sessions = await dependencies.publishSessionService.listAll();
    return jsonResponse({ sessions: sessions.map(readablePublishSession) });
  }
  if (url.pathname === "/admin/publish-sessions" && request.method === "POST") {
    await requireAdmin(request, dependencies.adminAuthService);
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
    await requireAdmin(request, dependencies.adminAuthService);
    const [, sessionId, uploadId] = adminVerifyUploadMatch;
    if (!sessionId || !uploadId) {
      throw new NotFoundError();
    }
    const result = await dependencies.publishSessionService.verifyUploadAsAdmin({
      sessionId,
      uploadId,
    });
    return jsonResponse({ ...result, session: readablePublishSession(result.session) });
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
    const uploadIndex = session.uploads.findIndex((upload) => upload.uploadId === uploadId);
    if (uploadIndex === -1) {
      throw new NotFoundError(`Upload not found: ${uploadId}`);
    }
    const target = session.uploads[uploadIndex]!;
    const expected = session.artifacts[uploadIndex];
    if (!expected) {
      throw new ValidationError(`Upload is not paired with an artifact: ${uploadId}`);
    }
    ensureUploadTargetIsWritable(session, target);
    const contentType = request.headers.get("content-type");
    await localUploadBroker.putUpload({
      target,
      body: await readUploadBody(request, expected.size),
      ...(contentType ? { contentType } : {}),
    });
    return new Response(null, { status: 204 });
  }
  const adminFinalizeMatch = url.pathname.match(/^\/admin\/publish-sessions\/([^/]+)\/finalize$/);
  if (adminFinalizeMatch && request.method === "POST") {
    await requireAdmin(request, dependencies.adminAuthService);
    const [, sessionId] = adminFinalizeMatch;
    if (!sessionId) {
      throw new NotFoundError();
    }
    const result = await dependencies.publishSessionService.finalizeAsAdmin({
      sessionId,
    });
    return jsonResponse({ ...result, session: readablePublishSession(result.session) });
  }
  if (url.pathname === "/api/publish-sessions" && request.method === "GET") {
    const secret = requireBearer(request);
    const principal = await dependencies.publishTokenService.verify(secret);
    const sessions = await dependencies.publishSessionService.list({ principal });
    return jsonResponse({ sessions: sessions.map(readablePublishSession) });
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
    return jsonResponse({ session: readablePublishSession(session) });
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
    return jsonResponse({ ...result, session: readablePublishSession(result.session) });
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
    return jsonResponse({ ...result, session: readablePublishSession(result.session) });
  }
  const clientHelperPath = servesArtifacts ? parseRepositoryClientHelperPath(request.url) : null;
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
        origin: publicArtifactOrigin(url, dependencies),
      });
    }
  }
  const uploadProtocolPath = servesArtifacts ? parseRepositoryObjectPath(request.url) : null;
  if (uploadProtocolPath && request.method === "POST") {
    const response = await handleProtocolUpload(dependencies, request, uploadProtocolPath);
    if (response) {
      return response;
    }
  }
  const repositoryObjectPath = servesArtifacts ? parseRepositoryObjectPath(request.url) : null;
  if (repositoryObjectPath && (request.method === "GET" || request.method === "HEAD")) {
    const { repositoryName, relativePath } = repositoryObjectPath;
    const repository = await dependencies.repositoryService.getByName(repositoryName);
    const accept = request.headers.get("accept");
    const served = await resolveServedRepositoryPath(dependencies, repository, {
      relativePath,
      ...(accept ? { accept } : {}),
    });
    await authorizeRepositoryRead(request, dependencies, repository);
    const objectKey = `repositories/${repositoryName}/${served.objectPath}`;
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
      metadata: served.contentType ? { ...metadata, contentType: served.contentType } : metadata,
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
