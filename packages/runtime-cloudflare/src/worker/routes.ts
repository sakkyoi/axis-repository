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
  type RepositoryKind,
  type RepositoryVisibility,
  type RepositoryObject,
  type RepositoryObjectList,
  type RepositoryObjectMetadata,
  type RepositoryObjectRange,
  type RuntimeSettingsRecord,
  validateRuntimeSettingsRecord,
} from "@axis-repository/core";
import { resolvePluginIconAssets } from "@axis-repository/core/plugin-icons";
import { getRepositoryPluginCatalogEntry, repositoryPluginCatalog } from "@axis-repository/plugin-catalog";
import { adminUiAssets, injectAdminUiRuntimeConfig, type AdminUiAsset } from "../admin-ui-assets";
import { formatBootstrapWarningLog, leftoverBootstrapCredentials, leftoverBootstrapWarning } from "./bootstrap-credentials";
import type { AppDependencies } from "./dev-dependencies";
import { isStringArray, optionalObjectField, readJsonObject, requireAdmin, requireBasicAuthSecret, requireBearer, stringArrayField, stringField } from "../http";
import {
  ensureRepositoryPluginEnabled as ensureEffectiveRepositoryPluginEnabled,
  repositoryPluginPolicyFields,
} from "../plugins/repository-plugin-policy";
import { dispatchRepositoryAdminResource } from "../plugins/repository-plugin-admin-resources";
import type { ProtocolUploadSink, RepositoryObjectBrowserListing } from "../plugins/repository-plugin-contract";
import { createIncrementalDigest } from "../storage/digest";
import { scopeObjectStoreToRepository, scopeSecretsToEcosystem } from "../plugins/scoped-capabilities";
import { dispatchRepositoryClientHelper } from "../plugins/repository-plugin-client-helpers";
import { adminRefreshCookie, clearAdminRefreshCookie, refreshTokenFromCookie, requestIsSecure } from "../auth/admin-auth";
import {
  compositeRepositoryFaviconSvg,
  directoryNeedsTrailingSlash,
  readRepositoryDirectory,
  REPOSITORY_BROWSER_PAGE_QUERY_PARAM,
  REPOSITORY_FAVICON_QUERY_PARAM,
  renderRepositoryDirectoryHtml,
  trailingSlashRedirectLocation,
  type RepositoryDirectoryListing,
} from "./repository-directory";

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
  // An error nothing here anticipated is the one worth being able to read. The
  // response cannot carry it — it may say more about the deployment than a
  // caller should learn — so it is logged, where `wrangler tail` will show it.
  // Caught and answered, it raises no exception the runtime would report, so
  // without this a 500 leaves no account of itself anywhere.
  console.error("unhandled error while answering request:", error);
  return jsonResponse(
    { error: { code: "internal_error", message: "Internal Server Error" } },
    { status: 500 },
  );
}

async function wakeBackgroundJobs(
  dependencies: Pick<AppDependencies, "scheduleBackgroundJobs" | "backgroundTasks">,
): Promise<void> {
  const task = dependencies.scheduleBackgroundJobs?.();
  if (!task) return;
  if (dependencies.backgroundTasks) {
    dependencies.backgroundTasks.waitUntil(task);
    return;
  }
  await task;
}

function repositoryVisibility(body: Record<string, unknown>): "private" | "public" {
  if (body.visibility === undefined) return "private";
  if (body.visibility === "private" || body.visibility === "public") return body.visibility;
  throw new ValidationError("visibility must be private or public");
}

function repositoryKind(body: Record<string, unknown>): RepositoryKind | undefined {
  if (body.kind === undefined) return undefined;
  if (body.kind === "hosted" || body.kind === "proxy" || body.kind === "group") return body.kind;
  throw new ValidationError("kind must be hosted, proxy, or group");
}

function repositoryKindSearchParams(searchParams: URLSearchParams): RepositoryKind[] | undefined {
  const values = searchParams.getAll("kind");
  if (values.length === 0) return undefined;
  const kinds: RepositoryKind[] = [];
  for (const value of values) {
    if (value === "hosted" || value === "proxy" || value === "group") {
      kinds.push(value);
      continue;
    }
    throw new ValidationError("kind must be hosted, proxy, or group");
  }
  return kinds;
}

function repositoryListLimit(searchParams: URLSearchParams): number | undefined {
  const value = searchParams.get("limit");
  if (value === null) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new ValidationError("limit must be a positive integer");
  }
  return Math.min(parsed, 50);
}

function repositoryNeedsInitialIndexJob(repository: Repository): boolean {
  return repository.kind === "proxy" || repository.kind === "group";
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

function runtimePluginMetadataByEcosystem(registeredPlugins: ReturnType<AppDependencies["repositoryRuntimePlugins"]["list"]>) {
  const metadata = new Map<string, (typeof registeredPlugins)[number]>();
  for (const plugin of registeredPlugins) {
    const existing = metadata.get(plugin.ecosystem);
    if (!existing) {
      metadata.set(plugin.ecosystem, {
        ...plugin,
        repositoryKinds: plugin.repositoryKinds.map((capability) => ({ ...capability })),
        capabilities: [...plugin.capabilities],
      });
      continue;
    }
    const repositoryKindsByKind = new Map(existing.repositoryKinds.map((capability) => [capability.kind, capability]));
    for (const capability of plugin.repositoryKinds) {
      repositoryKindsByKind.set(capability.kind, { ...capability });
    }
    metadata.set(plugin.ecosystem, {
      ...existing,
      repositoryKinds: Array.from(repositoryKindsByKind.values()),
      capabilities: Array.from(new Set([
        ...existing.capabilities,
        ...plugin.capabilities,
      ])),
      ...((existing.clientHelpers ?? plugin.clientHelpers)
        ? { clientHelpers: (existing.clientHelpers ?? plugin.clientHelpers)! }
        : {}),
    });
  }
  return metadata;
}

async function repositoryPluginMetadata(dependencies: AppDependencies) {
  const registeredPlugins = dependencies.repositoryRuntimePlugins.list();
  const registeredPluginsByEcosystem = runtimePluginMetadataByEcosystem(registeredPlugins);
  const catalogPlugins = await Promise.all(repositoryPluginCatalog.map(async (catalogEntry) => {
    const plugin = registeredPluginsByEcosystem.get(catalogEntry.manifest.ecosystem);
    const policy = await repositoryPluginPolicyFields({
      pluginPolicyService: dependencies.pluginPolicyService,
      ecosystem: catalogEntry.manifest.ecosystem,
      catalogEnabled: catalogEntry.enabled,
    });
    return {
      ...plugin,
      ecosystem: catalogEntry.manifest.ecosystem,
      name: catalogEntry.manifest.runtimeName,
      version: catalogEntry.manifest.version,
      icon: { ...catalogEntry.icon },
      capabilities: [...catalogEntry.manifest.capabilities],
      repositoryKinds: catalogEntry.manifest.repositoryKinds.map((capability) => ({ ...capability })),
      ...(catalogEntry.manifest.clientHelpers
        ? {
            clientHelpers: {
              namespace: catalogEntry.manifest.clientHelpers.namespace,
              actions: catalogEntry.manifest.clientHelpers.actions.map((action) => ({ ...action })),
            },
          }
        : {}),
      ...policy,
      experimental: catalogEntry.experimental,
      runtime: catalogEntry.runtime,
      adminUi: catalogEntry.adminUi,
    };
  }));
  const catalogEcosystems = new Set<string>(repositoryPluginCatalog.map((entry) => entry.manifest.ecosystem));
  const uncatalogedPlugins = await Promise.all(Array.from(registeredPluginsByEcosystem.values())
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
        icon: resolvePluginIconAssets(undefined),
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

/**
 * Upper bound on a declared artifact size.
 *
 * Reachable only where the upload is presigned and goes to R2 directly. An
 * upload relayed by the worker meets Cloudflare's limit on a request body
 * first -- 100 MB on the free plan, more on the paid ones -- and is refused at
 * the edge with a bare 413 the worker never sees, so nothing here can explain
 * it or count it. Measured on a free-plan deployment: 90 MiB relayed through,
 * 110 MiB did not.
 */
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

/**
 * Sends a client to fetch the object for itself.
 *
 * The redirect may be cached, but never for longer than the URL it names stays
 * valid: a cache holding it past that would send readers to a signature R2 has
 * stopped accepting. A private repository's redirect is not stored at all,
 * since the URL is a capability to read the object and outlives the
 * authorization that produced it.
 */
function signedObjectRedirect(input: {
  url: string;
  ttlSeconds: number;
  repository: Repository;
}): Response {
  const headers = new Headers({ location: input.url });
  headers.set(
    "cache-control",
    input.repository.visibility === "public"
      ? `public, max-age=${Math.max(0, Math.floor(input.ttlSeconds / 2))}`
      : "private, no-store",
  );
  return new Response(null, { status: 302, headers });
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

const SHARED_PUBLIC_ASSET_PATHS = new Set([
  "/logo-mark-dark.svg",
  "/logo-mark-light.svg",
]);

function sharedPublicAssetResponse(pathname: string, dependencies: AppDependencies): Response | null {
  if (!SHARED_PUBLIC_ASSET_PATHS.has(pathname)) {
    return null;
  }
  const asset = adminUiAssets.get(pathname);
  return asset ? adminUiAssetResponse(asset, dependencies) : null;
}

function textAsset(pathname: string): string {
  const asset = adminUiAssets.get(pathname);
  if (!asset) {
    throw new Error(`Missing embedded asset: ${pathname}`);
  }
  if (typeof asset.body === "string") {
    return asset.body;
  }
  if (asset.body instanceof Uint8Array) {
    return new TextDecoder().decode(asset.body);
  }
  throw new Error(`Embedded asset is not text-compatible: ${pathname}`);
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
  // A single trailing slash is kept rather than rejected: a format that serves
  // directory indexes distinguishes `simple/` from `simple`. Any other empty
  // segment is still refused, so `a//b` stays out.
  const trailingSlash = rawSegments.length > 1 && rawSegments[rawSegments.length - 1] === "";
  const namedSegments = trailingSlash ? rawSegments.slice(0, -1) : rawSegments;
  if (namedSegments.length === 0) {
    return null;
  }
  const decodedSegments = namedSegments.map(requireSafePathSegment);
  const [repositoryName, ...relativeSegments] = decodedSegments;
  if (!repositoryName) {
    return null;
  }
  // The repository root is a path in its own right: it is what a browser is
  // pointed at, and it lists the trees the repository publishes.
  if (relativeSegments.length === 0) {
    return { repositoryName, relativePath: "" };
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
  const plugin = dependencies.repositoryRuntimePlugins.getPluginForRepository(repository);
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
  artifactFamilies: /^\/admin\/repositories\/([^/]+)\/artifacts\/families$/,
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
  const plugin = dependencies.repositoryRuntimePlugins.getPluginForRepository(repository);
  // The repository root is not a path any plugin serves an object at; it is
  // the directory above the trees they do, and its listing is filtered by the
  // same rule, so nothing appears there that the plugin would not hand out.
  if (context.relativePath === "") {
    return { objectPath: "" };
  }
  if (!plugin?.canServeRepositoryPath(context)) {
    throw new NotFoundError();
  }

  const resolved = plugin.resolveRepositoryPath?.(context)
    ?? { objectPath: context.relativePath };
  return resolved.objectPath === ""
    ? resolved
    : { ...resolved, objectPath: requireSafeRelativePath(resolved.objectPath) };
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
  const plugin = dependencies.repositoryRuntimePlugins.getPluginForRepository(repository);
  const protocol = plugin?.kind === "hosted" ? plugin.uploadProtocol : undefined;
  if (!protocol || path.relativePath.replace(/\/+$/, "") !== protocol.path) {
    return null;
  }

  await ensureRepositoryPluginEnabled(dependencies, repository.ecosystem, () => new NotFoundError());
  const principal = await dependencies.publishTokenService.verify(requireBasicAuthSecret(request));
  const uploads = await protocol.parseUpload(request, protocolUploadSink(dependencies, repository.name));
  if (uploads.length === 0) {
    throw new ValidationError("Upload does not carry an artifact");
  }

  try {
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
      // The bytes are already stored; the session adopts them where it expects
      // to find them rather than being handed them again.
      await dependencies.repositoryObjectStore.copyObject(
        upload.storedKey,
        target.objectKey,
        upload.artifact.contentType,
      );
      await dependencies.publishSessionService.verifyUpload({
        sessionId: session.id,
        uploadId: target.uploadId,
        principal,
      });
    }

    await dependencies.publishFinalizeJobService.request({ sessionId: session.id, principal });
    await wakeBackgroundJobs(dependencies);
  } finally {
    // The staged copy has served its purpose whether or not the publish did.
    for (const upload of uploads) {
      await dependencies.repositoryObjectStore.deleteObject(upload.storedKey).catch(() => undefined);
    }
  }

  return protocol.successResponse?.() ?? new Response(null, { status: 200 });
}

/**
 * Stores an arriving upload before anything knows how big it is.
 *
 * The publish session has to be told a size and a digest up front, and both
 * are only known once the bytes have gone past — so they go to storage first,
 * counted and hashed on the way, and the session adopts the result.
 */
function protocolUploadSink(
  dependencies: AppDependencies,
  repositoryName: string,
): ProtocolUploadSink {
  return {
    async store({ content, contentType }) {
      const key = `_staging/protocol/${repositoryName}/${crypto.randomUUID()}`;
      const writer = await dependencies.repositoryObjectStore.createPartWriter(key, contentType);
      const digest = await createIncrementalDigest("SHA-256");
      try {
        for await (const chunk of content) {
          await writer.write(chunk);
          await digest.update(chunk);
        }
        const { size } = await writer.complete();
        return { key, size, sha256: await digest.hex() };
      } catch (error) {
        await writer.abort().catch(() => undefined);
        throw error;
      }
    },
  };
}

/**
 * Answers a directory in the repository tree with a browsable listing.
 *
 * Returns null when the path is not a directory, or is one nothing was
 * published under, so the caller can answer 404 as before. A path without its
 * trailing slash is redirected rather than listed, because the links in a
 * listing are relative to it.
 */
async function repositoryDirectoryResponse(input: {
  dependencies: AppDependencies;
  repository: Repository;
  requestUrl: string;
  relativePath: string;
  method: string;
  virtual?: boolean;
  browsePathPrefix?: string;
}): Promise<Response | null> {
  const directoryPageLimit = 200;
  const plugin = input.dependencies.repositoryRuntimePlugins.getPluginForRepository(input.repository);
  if (!plugin) {
    return null;
  }
  const url = new URL(input.requestUrl);
  const favicon = repositoryFaviconResponse(input.repository, url, input.method);
  if (favicon) {
    return favicon;
  }
  const isRoot = input.relativePath === "";
  const directoryPath = isRoot || input.relativePath.endsWith("/")
    ? input.relativePath
    : `${input.relativePath}/`;
  // Only a path the plugin serves may be browsed, except the root, which sits
  // above every such path.
  if (!isRoot && !plugin.canServeRepositoryPath({ relativePath: directoryPath })) {
    return null;
  }

  const virtualListing = input.virtual
    ? await plugin.objectBrowser?.listObjects({
      repository: input.repository,
      objectStore: input.dependencies.repositoryObjectStore,
      repositoryArtifactStore: input.dependencies.repositoryArtifactStore,
      prefix: directoryPath,
      limit: directoryPageLimit,
    })
    : undefined;
  const listing = virtualListing
    ? repositoryObjectBrowserDirectoryListing(virtualListing)
    : await readRepositoryDirectory({
    objectStore: input.dependencies.repositoryObjectStore,
    repositoryName: input.repository.name,
    relativePath: directoryPath,
    canServe: (relativePath) => plugin.canServeRepositoryPath({ relativePath }),
    limit: directoryPageLimit,
  });
  if (!listing) {
    return null;
  }

  if (directoryNeedsTrailingSlash(url.pathname)) {
    return new Response(null, {
      status: 301,
      headers: { location: trailingSlashRedirectLocation(url.pathname, url.search) },
    });
  }

  const renderInput = {
    repositoryName: input.repository.name,
    repositoryEcosystem: input.repository.ecosystem,
    pluginIcon: repositoryPluginIcon(input.repository),
    listing,
    ...(input.browsePathPrefix !== undefined ? { browsePathPrefix: input.browsePathPrefix } : {}),
  };
  const body = input.method === "HEAD"
    ? null
    : renderRepositoryDirectoryHtml(renderInput);
  return new Response(body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": repositoryCacheControl(input.repository),
    },
  });
}

function parseRuntimeSettingsUpdate(body: Record<string, unknown>): RuntimeSettingsRecord {
  return validateRuntimeSettingsRecord(body as RuntimeSettingsRecord);
}

async function repositoryDirectoryPageJsonResponse(input: {
  dependencies: AppDependencies;
  repository: Repository;
  requestUrl: string;
  relativePath: string;
  virtual?: boolean;
}): Promise<Response | null> {
  const directoryPageLimit = 200;
  const plugin = input.dependencies.repositoryRuntimePlugins.getPluginForRepository(input.repository);
  if (!plugin) {
    return null;
  }
  const url = new URL(input.requestUrl);
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const isRoot = input.relativePath === "";
  const directoryPath = isRoot || input.relativePath.endsWith("/")
    ? input.relativePath
    : `${input.relativePath}/`;
  if (!isRoot && !plugin.canServeRepositoryPath({ relativePath: directoryPath })) {
    return null;
  }

  const virtualListing = input.virtual
    ? await plugin.objectBrowser?.listObjects({
      repository: input.repository,
      objectStore: input.dependencies.repositoryObjectStore,
      repositoryArtifactStore: input.dependencies.repositoryArtifactStore,
      prefix: directoryPath,
      ...(cursor !== undefined ? { cursor } : {}),
      limit: directoryPageLimit,
    })
    : undefined;
  const listing = virtualListing
    ? repositoryObjectBrowserDirectoryListing(virtualListing)
    : await readRepositoryDirectory({
      objectStore: input.dependencies.repositoryObjectStore,
      repositoryName: input.repository.name,
      relativePath: directoryPath,
      canServe: (relativePath) => plugin.canServeRepositoryPath({ relativePath }),
      ...(cursor !== undefined ? { cursor } : {}),
      limit: directoryPageLimit,
    });
  if (!listing) {
    return null;
  }
  return jsonResponse({
    listing,
    cursor: listing.cursor ?? null,
    truncated: listing.truncated ?? false,
  }, {
    headers: { "cache-control": repositoryCacheControl(input.repository) },
  });
}

function repositoryFaviconResponse(repository: Repository, url: URL, method: string): Response | null {
  const faviconTheme = url.searchParams.get(REPOSITORY_FAVICON_QUERY_PARAM);
  if (faviconTheme !== "light" && faviconTheme !== "dark") {
    return null;
  }
  const logoMarks = {
    light: textAsset("/logo-mark-light.svg"),
    dark: textAsset("/logo-mark-dark.svg"),
  };
  const svg = compositeRepositoryFaviconSvg(logoMarks[faviconTheme], repositoryPluginIcon(repository));
  return new Response(method === "HEAD" ? null : svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": repositoryCacheControl(repository),
    },
  });
}

function repositoryPluginIcon(repository: Repository) {
  const catalogEntry = getRepositoryPluginCatalogEntry(repository.ecosystem);
  return catalogEntry?.icon ?? resolvePluginIconAssets(undefined);
}

function repositoryObjectBrowserDirectoryListing(listing: RepositoryObjectBrowserListing): RepositoryDirectoryListing {
  return {
    relativePath: listing.prefix,
    entries: [
      ...listing.directories.map((directory) => ({
        name: `${directory.name.replace(/\/+$/g, "")}/`,
        relativePath: directory.path,
        directory: true,
      })),
      ...listing.objects.map((object) => ({
        name: object.name,
        relativePath: object.path,
        directory: false,
        ...(object.size !== undefined ? { size: object.size } : {}),
      })),
    ],
    ...(listing.cursor !== undefined ? { cursor: listing.cursor } : {}),
    truncated: listing.truncated,
  };
}

function parseRepositoryBrowsePath(requestUrl: string): { repositoryName: string; relativePath: string } | null {
  const rawPath = rawPathname(requestUrl);
  const prefix = "/repositories/";
  if (!rawPath.startsWith(prefix)) {
    return null;
  }
  const rawRest = rawPath.slice(prefix.length);
  const rawSegments = rawRest.split("/");
  const trailingSlash = rawSegments.length > 1 && rawSegments[rawSegments.length - 1] === "";
  const namedSegments = trailingSlash ? rawSegments.slice(0, -1) : rawSegments;
  if (namedSegments.length < 2 || namedSegments[1] !== "_browse") {
    return null;
  }
  const [rawRepositoryName, _browse, ...rawRelativeSegments] = namedSegments;
  const repositoryName = requireSafePathSegment(rawRepositoryName ?? "");
  const relativeSegments = rawRelativeSegments.map(requireSafePathSegment);
  if (relativeSegments.length === 0) {
    return { repositoryName, relativePath: "" };
  }
  return {
    repositoryName,
    relativePath: `${relativeSegments.join("/")}${trailingSlash ? "/" : ""}`,
  };
}

function isRepositoryBrowserNavigation(request: Request): boolean {
  if (request.headers.get("sec-fetch-dest") === "document") {
    return true;
  }
  return prefersBrowserHtml(request.headers.get("accept"));
}

function prefersBrowserHtml(accept: string | null): boolean {
  if (!accept) {
    return false;
  }
  let htmlQuality = 0;
  let browserDocumentQuality = 0;
  let repositoryApiQuality = 0;
  for (const entry of accept.split(",")) {
    const [type = "", ...parameters] = entry.trim().split(";").map((part) => part.trim());
    const quality = Number(parameters.find((parameter) => parameter.startsWith("q="))?.slice(2) ?? "1");
    if (!Number.isFinite(quality) || quality <= 0) {
      continue;
    }
    if (type === "text/html") {
      htmlQuality = Math.max(htmlQuality, quality);
    } else if (type === "application/xhtml+xml") {
      browserDocumentQuality = Math.max(browserDocumentQuality, quality);
    } else if (type.startsWith("application/vnd.")) {
      repositoryApiQuality = Math.max(repositoryApiQuality, quality);
    }
  }
  return browserDocumentQuality > 0
    && Math.max(htmlQuality, browserDocumentQuality) >= repositoryApiQuality;
}

async function pluginRepositoryPathResponse(input: {
  dependencies: AppDependencies;
  repository: Repository;
  request: Request;
  relativePath: string;
  accept?: string;
}): Promise<Response | null> {
  const plugin = input.dependencies.repositoryRuntimePlugins.getPluginForRepository(input.repository);
  if (plugin?.kind === "hosted") {
    if (input.request.method !== "GET" && input.request.method !== "HEAD") {
      return null;
    }
    const served = await resolveServedRepositoryPath(input.dependencies, input.repository, {
      relativePath: input.relativePath,
      ...(input.accept ? { accept: input.accept } : {}),
    }).catch((error) => {
      if (error instanceof NotFoundError) return null;
      throw error;
    });
    if (!served || served.objectPath === "") {
      return null;
    }
    const objectKey = `repositories/${input.repository.name}/${served.objectPath}`;
    const metadata = await input.dependencies.repositoryObjectStore.headObject(objectKey);
    if (!metadata) {
      return null;
    }
    const rangeHeader = input.request.method === "GET" ? input.request.headers.get("range") : null;
    const parsedRange = parseRangeHeader(rangeHeader, metadata.contentLength);
    if (rangeHeader && !parsedRange) {
      return rangeNotSatisfiableResponse(metadata, repositoryCacheControl(input.repository));
    }
    const object = input.request.method === "HEAD"
      ? null
      : await input.dependencies.repositoryObjectStore.getObject(
        objectKey,
        parsedRange ? { range: parsedRange.range } : undefined,
      );
    if (input.request.method === "GET" && !object) {
      return null;
    }
    return objectResponse({
      method: input.request.method,
      object,
      metadata: served.contentType ? { ...metadata, contentType: served.contentType } : metadata,
      cacheControl: repositoryCacheControl(input.repository),
      ...(parsedRange ? { range: parsedRange } : {}),
    });
  }
  if ((plugin?.kind !== "proxy" && plugin?.kind !== "group") || !plugin.serveRepositoryPath) {
    return null;
  }
  return plugin.serveRepositoryPath({
    repository: input.repository,
    request: input.request,
    relativePath: input.relativePath,
    objectStore: scopeObjectStoreToRepository(input.dependencies.repositoryObjectStore, input.repository.name),
    ...(input.accept ? { accept: input.accept } : {}),
    ...(input.dependencies.backgroundTasks
      ? { backgroundTasks: input.dependencies.backgroundTasks }
      : {}),
    repositories: input.dependencies.repositoryService,
    repositoryArtifactStore: input.dependencies.repositoryArtifactStore,
    serveRepositoryPath: (delegateInput: {
      repository: Repository;
      request: Request;
      relativePath: string;
      accept?: string;
    }) => pluginRepositoryPathResponse({
      dependencies: input.dependencies,
      repository: delegateInput.repository,
      request: delegateInput.request,
      relativePath: delegateInput.relativePath,
      ...(delegateInput.accept ? { accept: delegateInput.accept } : {}),
    }),
  });
}

function requireSafeRelativePath(objectPath: string): string {
  // A directory path keeps its trailing slash; every other empty segment, and
  // any traversal, is refused.
  const trailingSlash = objectPath.endsWith("/");
  const segments = (trailingSlash ? objectPath.slice(0, -1) : objectPath).split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new NotFoundError();
  }
  return `${segments.join("/")}${trailingSlash ? "/" : ""}`;
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
const DEFAULT_ARTIFACT_PAGE_LIMIT = 50;
const MAX_ARTIFACT_PAGE_LIMIT = 100;

function repositoryActivityPageParams(searchParams: URLSearchParams): RepositoryActivityPageParams {
  const limitParam = searchParams.get("limit");
  const limit = limitParam === null ? DEFAULT_ACTIVITY_PAGE_LIMIT : Number(limitParam);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ACTIVITY_PAGE_LIMIT) {
    throw new ValidationError(`limit must be an integer between 1 and ${MAX_ACTIVITY_PAGE_LIMIT}`);
  }
  const cursor = searchParams.get("cursor");
  return {
    limit,
    offset: cursor ? decodeOffsetCursor(cursor) : 0,
  };
}

function repositoryActivityPage<T>(activities: T[], params: RepositoryActivityPageParams) {
  const end = params.offset + params.limit;
  const pageActivities = activities.slice(params.offset, end);
  const truncated = end < activities.length;
  return {
    activities: pageActivities,
    truncated,
    ...(truncated ? { cursor: encodeOffsetCursor(end) } : {}),
  };
}

function repositoryArtifactPage<T>(records: T[], total: number, params: RepositoryActivityPageParams) {
  const end = params.offset + params.limit;
  const truncated = end < total;
  return {
    artifacts: records,
    truncated,
    ...(truncated ? { cursor: encodeOffsetCursor(end) } : {}),
  };
}

function repositoryArtifactFamilyPage<T>(
  records: T[],
  totals: { totalFamilies: number; totalArtifacts: number },
  params: RepositoryActivityPageParams,
) {
  const end = params.offset + params.limit;
  const truncated = end < totals.totalFamilies;
  return {
    families: records,
    totalFamilies: totals.totalFamilies,
    totalArtifacts: totals.totalArtifacts,
    truncated,
    ...(truncated ? { cursor: encodeOffsetCursor(end) } : {}),
  };
}

function repositoryArtifactPageParams(searchParams: URLSearchParams): RepositoryActivityPageParams {
  return offsetPageParams(searchParams, DEFAULT_ARTIFACT_PAGE_LIMIT, MAX_ARTIFACT_PAGE_LIMIT);
}

function offsetPageParams(searchParams: URLSearchParams, defaultLimit: number, maxLimit: number): RepositoryActivityPageParams {
  const limitParam = searchParams.get("limit");
  const limit = limitParam === null ? defaultLimit : Number(limitParam);
  if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) {
    throw new ValidationError(`limit must be an integer between 1 and ${maxLimit}`);
  }
  const cursor = searchParams.get("cursor");
  return {
    limit,
    offset: cursor ? decodeOffsetCursor(cursor) : 0,
  };
}

function optionalPositiveIntegerSearchParam(url: URL, name: string): number | undefined {
  const value = url.searchParams.get(name);
  if (value === null) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new ValidationError(`${name} must be a positive integer`);
  }
  return parsed;
}

function optionalNonNegativeIntegerSearchParam(url: URL, name: string): number | undefined {
  const value = url.searchParams.get(name);
  if (value === null) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new ValidationError(`${name} must be a non-negative integer`);
  }
  return parsed;
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
  // Only before verification. Once a session is "ready" its uploads have been
  // checksummed, and finalize trusts those recorded digests rather than
  // re-reading the bytes, so a later write would publish content that does not
  // match the signed index.
  if (session.status !== "pending_uploads") {
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
 * Refuses an upload that says up front it is too big.
 *
 * Only a hint, and cheap: a chunked request declares no length at all, so this
 * cannot be the limit -- it saves reading a body already known to be doomed,
 * and the real check counts the bytes as they arrive.
 */
function ensureDeclaredUploadLengthFits(request: Request, expectedSize: number): void {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength === null) {
    return;
  }
  const length = Number(declaredLength);
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new ValidationError("content-length must be a non-negative integer");
  }
  if (length > expectedSize) {
    throw new ValidationError("Uploaded object is larger than the declared artifact size");
  }
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

/**
 * Puts what a deployment is still carrying into its own log.
 *
 * Never allowed to fail the request that noticed it. This is a remark about
 * configuration, and a sign-in that has already succeeded should not be turned
 * into an error by the attempt to mention it.
 */
async function warnAboutLeftoverBootstrapCredentials(dependencies: AppDependencies): Promise<void> {
  try {
    const warning = leftoverBootstrapWarning(
      leftoverBootstrapCredentials(await dependencies.adminAuthService.unusedBootstrapCredentials()),
    );
    if (warning) {
      console.warn(formatBootstrapWarningLog(warning));
    }
  } catch {
    // Nothing to do about it, and nothing worth failing a sign-in over.
  }
}

export async function dispatch(request: Request, dependencies: AppDependencies): Promise<Response> {
  const url = new URL(request.url);
  const { servesArtifacts, servesAdmin } = originRoles(url, dependencies);
  if (url.pathname === "/health") {
    return jsonResponse({ ok: true, service: "axis-repository" });
  }
  const sharedAsset = sharedPublicAssetResponse(url.pathname, dependencies);
  if (sharedAsset) {
    return sharedAsset;
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
    // Said at sign-in rather than on every request: an operator is here, and
    // the deployment has just proved it no longer needs what seeded it.
    await warnAboutLeftoverBootstrapCredentials(dependencies);
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
  if (url.pathname === "/admin/deployment") {
    // Behind admin auth: that a bootstrap password is still set is a thing to
    // tell an operator, not something to publish to anyone who asks.
    await requireAdmin(request, dependencies.adminAuthService);
    if (request.method === "GET") {
      return jsonResponse({
        capabilities: dependencies.deploymentCapabilities,
        leftoverBootstrapCredentials: leftoverBootstrapCredentials(
          await dependencies.adminAuthService.unusedBootstrapCredentials(),
        ),
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
  if (url.pathname === "/admin/jobs") {
    await requireAdmin(request, dependencies.adminAuthService);
    if (request.method === "GET") {
      const limit = optionalPositiveIntegerSearchParam(url, "limit");
      const offset = optionalNonNegativeIntegerSearchParam(url, "offset");
      return jsonResponse(await dependencies.backgroundJobService.list({
        ...(url.searchParams.has("repositoryName") ? { repositoryName: url.searchParams.get("repositoryName") ?? "" } : {}),
        ...(url.searchParams.has("status") ? { status: url.searchParams.get("status") as never } : {}),
        ...(url.searchParams.has("type") ? { type: url.searchParams.get("type") as never } : {}),
        ...(limit === undefined ? {} : { limit }),
        ...(offset === undefined ? {} : { offset }),
      }));
    }
    throw new NotFoundError();
  }
  const adminJobMatch = url.pathname.match(/^\/admin\/jobs\/([^/]+)$/);
  if (adminJobMatch) {
    await requireAdmin(request, dependencies.adminAuthService);
    const jobId = decodeURIComponent(adminJobMatch[1] ?? "");
    if (request.method === "GET") {
      const job = await dependencies.backgroundJobService.get(jobId);
      if (!job) throw new NotFoundError();
      return jsonResponse({ job });
    }
    throw new NotFoundError();
  }
  const adminCancelJobMatch = url.pathname.match(/^\/admin\/jobs\/([^/]+)\/cancel$/);
  if (adminCancelJobMatch) {
    await requireAdmin(request, dependencies.adminAuthService);
    if (request.method === "POST") {
      const job = await dependencies.backgroundJobService.cancel(decodeURIComponent(adminCancelJobMatch[1] ?? ""));
      if (!job) throw new NotFoundError();
      return jsonResponse({ job });
    }
    throw new NotFoundError();
  }
  const adminRetryJobMatch = url.pathname.match(/^\/admin\/jobs\/([^/]+)\/retry$/);
  if (adminRetryJobMatch) {
    await requireAdmin(request, dependencies.adminAuthService);
    if (request.method === "POST") {
      const job = await dependencies.backgroundJobService.retry(decodeURIComponent(adminRetryJobMatch[1] ?? ""));
      if (!job) throw new NotFoundError();
      await wakeBackgroundJobs(dependencies);
      return jsonResponse({ job });
    }
    throw new NotFoundError();
  }
  if (url.pathname === "/admin/settings/runtime") {
    await requireAdmin(request, dependencies.adminAuthService);
    if (request.method === "GET") {
      return jsonResponse({
        settings: await dependencies.runtimeSettingsService.get(),
        overrides: await dependencies.runtimeSettingsService.getRecord(),
      });
    }
    if (request.method === "PATCH") {
      const overrides = await dependencies.runtimeSettingsService.update(parseRuntimeSettingsUpdate(await readJsonObject(request)));
      return jsonResponse({
        settings: await dependencies.runtimeSettingsService.get(),
        overrides,
      });
    }
    throw new NotFoundError();
  }
  if (url.pathname === "/admin/repositories") {
    await requireAdmin(request, dependencies.adminAuthService);
    if (request.method === "GET") {
      const ecosystem = url.searchParams.get("ecosystem") ?? undefined;
      const kinds = repositoryKindSearchParams(url.searchParams);
      const query = url.searchParams.get("q") ?? undefined;
      const limit = repositoryListLimit(url.searchParams);
      return jsonResponse({
        repositories: await dependencies.repositoryService.list({
          ...(ecosystem === undefined ? {} : { ecosystem }),
          ...(kinds === undefined ? {} : { kinds }),
          ...(query === undefined ? {} : { query }),
          excludeNames: url.searchParams.getAll("exclude"),
          ...(limit === undefined ? {} : { limit }),
        }),
      });
    }
    if (request.method === "POST") {
      const body = await readJsonObject(request);
      const provisioning = optionalObjectField(body, "provisioning");
      const kind = repositoryKind(body);
      const repository = await dependencies.repositoryService.create({
        name: stringField(body, "name"),
        ecosystem: stringField(body, "ecosystem"),
        ...(kind === undefined ? {} : { kind }),
        visibility: repositoryVisibility(body),
        config: optionalObjectField(body, "config") ?? {},
        ...(provisioning === undefined ? {} : { provisioning }),
      });
      if (repositoryNeedsInitialIndexJob(repository)) {
        await dependencies.backgroundJobService.requestRepositoryIndex({ repositoryName: repository.name });
        await wakeBackgroundJobs(dependencies);
      }
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
      const repository = await dependencies.repositoryService.update(adminRepositoryName, parseRepositoryUpdate(body));
      if (repositoryNeedsInitialIndexJob(repository) && body.config !== undefined) {
        await dependencies.backgroundJobService.requestRepositoryIndex({ repositoryName: repository.name });
        await wakeBackgroundJobs(dependencies);
      }
      return jsonResponse(repository);
    }
    if (request.method === "DELETE") {
      const job = await dependencies.repositoryDeleteJobService.request({ repositoryName: adminRepositoryName });
      await wakeBackgroundJobs(dependencies);
      return jsonResponse({ job }, { status: 202 });
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
  const adminRepositoryArtifactFamiliesName = adminRepositoryNameFor(url.pathname, ADMIN_REPOSITORY_ROUTES.artifactFamilies);
  if (adminRepositoryArtifactFamiliesName) {
    await requireAdmin(request, dependencies.adminAuthService);
    if (request.method !== "GET") {
      throw new NotFoundError();
    }
    const repository = await dependencies.repositoryService.getByName(adminRepositoryArtifactFamiliesName);
    await ensureRepositoryPluginEnabled(dependencies, repository.ecosystem, () => new NotFoundError());
    const pageParams = repositoryArtifactPageParams(url.searchParams);
    const page = await dependencies.repositoryArtifactStore.listFamiliesByRepositoryPage(repository.name, pageParams);
    return jsonResponse({
      ...repositoryArtifactFamilyPage(page.records, {
        totalFamilies: page.totalFamilies,
        totalArtifacts: page.totalArtifacts,
      }, pageParams),
    });
  }
  const adminRepositoryArtifactsName = adminRepositoryNameFor(url.pathname, ADMIN_REPOSITORY_ROUTES.artifacts);
  if (adminRepositoryArtifactsName) {
    await requireAdmin(request, dependencies.adminAuthService);
    if (request.method !== "GET") {
      throw new NotFoundError();
    }
    const repository = await dependencies.repositoryService.getByName(adminRepositoryArtifactsName);
    await ensureRepositoryPluginEnabled(dependencies, repository.ecosystem, () => new NotFoundError());
    const family = url.searchParams.get("family");
    if (family !== null) {
      return jsonResponse({
        artifacts: await dependencies.repositoryArtifactStore.listByRepositoryFamily(repository.name, family),
        truncated: false,
      });
    }
    const pageParams = repositoryArtifactPageParams(url.searchParams);
    const page = await dependencies.repositoryArtifactStore.listByRepositoryPage(repository.name, pageParams);
    return jsonResponse(repositoryArtifactPage(page.records, page.total, pageParams));
  }
  const adminRepositoryArtifactsRebuildName = adminRepositoryNameFor(url.pathname, ADMIN_REPOSITORY_ROUTES.artifactsRebuildIndex);
  if (adminRepositoryArtifactsRebuildName) {
    await requireAdmin(request, dependencies.adminAuthService);
    if (request.method !== "POST") {
      throw new NotFoundError();
    }
    const repository = await dependencies.repositoryService.getByName(adminRepositoryArtifactsRebuildName);
    await ensureRepositoryPluginEnabled(dependencies, repository.ecosystem, () => new NotFoundError());
    const job = await dependencies.backgroundJobService.requestRepositoryIndex({ repositoryName: repository.name });
    await wakeBackgroundJobs(dependencies);
    return jsonResponse({ job }, { status: 202 });
  }
  const adminRepositoryArtifactPath = parseAdminRepositoryArtifactPath(url.pathname);
  if (adminRepositoryArtifactPath) {
    await requireAdmin(request, dependencies.adminAuthService);
    if (request.method !== "DELETE") {
      throw new NotFoundError();
    }
    const repository = await dependencies.repositoryService.getByName(adminRepositoryArtifactPath.repositoryName);
    await ensureRepositoryPluginEnabled(dependencies, repository.ecosystem, () => new NotFoundError());
    const job = await dependencies.repositoryArtifactDeleteJobService.request({
      repositoryName: repository.name,
      artifactId: adminRepositoryArtifactPath.artifactId,
    });
    await wakeBackgroundJobs(dependencies);
    return jsonResponse({ job }, { status: 202 });
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
    const plugin = dependencies.repositoryRuntimePlugins.getPluginForRepository(repository);
    const pluginDetail = await plugin?.objectBrowser?.getObjectDetail?.({
      repository,
      objectStore: dependencies.repositoryObjectStore,
      repositoryArtifactStore: dependencies.repositoryArtifactStore,
      path: relativePath,
      origin: publicArtifactOrigin(url, dependencies),
    });
    if (pluginDetail) {
      return jsonResponse({ object: pluginDetail });
    }
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
      const cursor = url.searchParams.get("cursor") ?? undefined;
      const limit = optionalPositiveIntegerSearchParam(url, "limit");
      const plugin = dependencies.repositoryRuntimePlugins.getPluginForRepository(repository);
      const pluginListing = await plugin?.objectBrowser?.listObjects({
        repository,
        objectStore: dependencies.repositoryObjectStore,
        repositoryArtifactStore: dependencies.repositoryArtifactStore,
        prefix,
        ...(cursor !== undefined ? { cursor } : {}),
        ...(limit !== undefined ? { limit } : {}),
      });
      if (pluginListing) {
        return jsonResponse(pluginListing);
      }
      const listing = await dependencies.repositoryObjectStore.listObjects({
        prefix: `repositories/${repository.name}/${prefix}`,
        delimiter: "/",
        ...(cursor !== undefined ? { cursor } : {}),
        ...(limit !== undefined ? { limit } : {}),
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
      const job = await dependencies.backgroundJobService.requestRepositoryIndex({ repositoryName: repository.name });
      await wakeBackgroundJobs(dependencies);
      return jsonResponse({ activity, job }, { status: 202 });
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
      ? dependencies.repositoryRuntimePlugins.getPluginForRepository(repository)
      : dependencies.repositoryRuntimePlugins.getPluginByAdminResourceNamespace(adminPluginResourcePath.namespace);
    if (plugin) {
      await ensureRepositoryPluginEnabled(dependencies, plugin.ecosystem, () => new NotFoundError());
    }
    const adminResources = plugin?.adminResources;
    if (!adminResources || adminResources.namespace !== adminPluginResourcePath.namespace) {
      throw new NotFoundError();
    }
    if (
      request.method === "POST"
      && repository?.kind === "proxy"
      && adminPluginResourcePath.path.length === 2
      && adminPluginResourcePath.path[0] === "proxy-cache"
      && adminPluginResourcePath.path[1] === "purge"
    ) {
      const job = await dependencies.repositoryProxyCachePurgeJobService.request({
        repositoryName: repository.name,
        namespace: adminPluginResourcePath.namespace,
      });
      await wakeBackgroundJobs(dependencies);
      return jsonResponse({ job }, { status: 202 });
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
        repositoryArtifactStore: dependencies.repositoryArtifactStore,
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
  const adminGetPublishSessionMatch = url.pathname.match(/^\/admin\/publish-sessions\/([^/]+)$/);
  if (adminGetPublishSessionMatch && request.method === "GET") {
    await requireAdmin(request, dependencies.adminAuthService);
    const [, sessionId] = adminGetPublishSessionMatch;
    if (!sessionId) {
      throw new NotFoundError();
    }
    const session = await dependencies.publishSessionService.getAsAdmin({ sessionId });
    return jsonResponse({ session: readablePublishSession(session) });
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
    ensureDeclaredUploadLengthFits(request, expected.size);
    await localUploadBroker.putUpload({
      target,
      body: request.body as ReadableStream<Uint8Array> | null,
      maxBytes: expected.size,
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
    const result = await dependencies.publishFinalizeJobService.requestAsAdmin({
      sessionId,
    });
    await wakeBackgroundJobs(dependencies);
    return jsonResponse({ ...result, session: readablePublishSession(result.session) }, { status: 202 });
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
    const result = await dependencies.publishFinalizeJobService.request({
      sessionId,
      principal,
    });
    await wakeBackgroundJobs(dependencies);
    return jsonResponse({ ...result, session: readablePublishSession(result.session) }, { status: 202 });
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
  const repositoryBrowsePath = servesArtifacts ? parseRepositoryBrowsePath(request.url) : null;
  if (repositoryBrowsePath) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      throw new NotFoundError();
    }
    const { repositoryName, relativePath } = repositoryBrowsePath;
    const repository = await dependencies.repositoryService.getByName(repositoryName);
    await authorizeRepositoryRead(request, dependencies, repository);
    if (url.searchParams.get(REPOSITORY_BROWSER_PAGE_QUERY_PARAM) === "1") {
      const listing = await repositoryDirectoryPageJsonResponse({
        dependencies,
        repository,
        requestUrl: request.url,
        relativePath,
        virtual: true,
      });
      if (listing) {
        return listing;
      }
      throw new NotFoundError();
    }
    const listing = await repositoryDirectoryResponse({
      dependencies,
      repository,
      requestUrl: request.url,
      relativePath,
      method: request.method,
      virtual: true,
      browsePathPrefix: "_browse/",
    });
    if (listing) {
      return listing;
    }
    throw new NotFoundError();
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
    await authorizeRepositoryRead(request, dependencies, repository);
    const favicon = repositoryFaviconResponse(repository, url, request.method);
    if (favicon) {
      return favicon;
    }
    const accept = request.headers.get("accept");
    const served = await resolveServedRepositoryPath(dependencies, repository, {
      relativePath,
      ...(accept ? { accept } : {}),
    });
    if (url.searchParams.get(REPOSITORY_BROWSER_PAGE_QUERY_PARAM) === "1") {
      const listing = await repositoryDirectoryPageJsonResponse({
        dependencies,
        repository,
        requestUrl: request.url,
        relativePath,
        virtual: true,
      });
      if (listing) {
        return listing;
      }
      throw new NotFoundError();
    }
    if (isRepositoryBrowserNavigation(request)) {
      const listing = await repositoryDirectoryResponse({
        dependencies,
        repository,
        requestUrl: request.url,
        relativePath,
        method: request.method,
        virtual: true,
      });
      if (listing) {
        return listing;
      }
    }
    const objectKey = `repositories/${repositoryName}/${served.objectPath}`;
    const metadata = served.objectPath === ""
      ? null
      : await dependencies.repositoryObjectStore.headObject(objectKey);
    if (!metadata) {
      // Nothing is stored here, so this may be a directory in the tree. A
      // listing is generated rather than stored, since the tree is only ever
      // whatever the objects say it is.
      const listing = await repositoryDirectoryResponse({
        dependencies,
        repository,
        requestUrl: request.url,
        relativePath,
        method: request.method,
      });
      if (listing) {
        return listing;
      }
      const pluginResponse = await pluginRepositoryPathResponse({
        dependencies,
        repository,
        request,
        relativePath,
        ...(accept ? { accept } : {}),
      });
      if (pluginResponse) {
        return pluginResponse;
      }
      throw new NotFoundError();
    }
    const cacheControl = repositoryCacheControl(repository);
    // A signed URL is handed back rather than the bytes: streaming an artifact
    // through the Worker bills for the whole transfer and keeps the request
    // open for the whole download. The request itself still resolves the path
    // and decides who may read it; only the transfer moves.
    //
    // HEAD is answered from metadata and never touched the bytes, so it stays;
    // redirecting it would add a round trip and take nothing off the Worker.
    // A request the plugin resolved to some other path is a generated index
    // addressed as a directory, and a client reads links out of it relative to
    // wherever it ended up. Sent to storage, `../../packages/x.whl` resolves
    // against the signed URL and becomes an unsigned one the bucket refuses.
    // Those are answered here so the links keep pointing at this origin; they
    // are small, and every file they name is redirected.
    const isGeneratedIndex = served.objectPath !== relativePath;
    const downloadSigner = dependencies.repositoryObjectDownloadSigner;
    if (downloadSigner && request.method === "GET" && !isGeneratedIndex) {
      return signedObjectRedirect({
        url: await downloadSigner.sign(objectKey),
        ttlSeconds: downloadSigner.ttlSeconds,
        repository,
      });
    }
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
