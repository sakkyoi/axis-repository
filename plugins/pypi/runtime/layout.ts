import type { PypiDistributionFilename } from "../shared/names";
import {
  HTML_CONTENT_TYPE,
  SIMPLE_HTML_CONTENT_TYPE,
  SIMPLE_INDEX_FILENAME,
  SIMPLE_JSON_CONTENT_TYPE,
  SIMPLE_JSON_FILENAME,
} from "./simple-index";

/**
 * Where a repository keeps its files.
 *
 * Two trees, both under the repository, mirroring how apt separates `pool`
 * from `dists`:
 *
 * - `packages/<project>/<filename>` — the distributions themselves, named by
 *   the project they belong to so one project's files sit together.
 * - `simple/` — the generated index, which is rewritten from the packages
 *   tree and owns nothing of its own.
 *
 * A published file must be reachable, so both prefixes are served. Staged
 * uploads are not: they live outside the repository tree and are not part of
 * what the repository publishes.
 */

export const PACKAGES_PREFIX = "packages";
export const SIMPLE_PREFIX = "simple";

/** Prefixes a client may fetch from, for the plugin's serving rule. */
export const SERVED_PREFIXES = [SIMPLE_PREFIX, PACKAGES_PREFIX];

/** Where a distribution is stored, relative to the repository. */
export function packageRelativePath(
  distribution: Pick<PypiDistributionFilename, "normalizedName">,
  filename: string,
): string {
  return `${PACKAGES_PREFIX}/${distribution.normalizedName}/${filename}`;
}

export function packageObjectKey(
  repositoryName: string,
  distribution: Pick<PypiDistributionFilename, "normalizedName">,
  filename: string,
): string {
  return `repositories/${repositoryName}/${packageRelativePath(distribution, filename)}`;
}

/**
 * Where a distribution's core metadata sits (PEP 658).
 *
 * Beside the distribution, under its own name — so the two travel together and
 * whatever accounts for one accounts for the other.
 */
export function coreMetadataKey(distributionKey: string): string {
  return `${distributionKey}.metadata`;
}

/** PEP 658 serves core metadata as plain text, the way METADATA is written. */
export const CORE_METADATA_CONTENT_TYPE = "text/plain; charset=utf-8";

/**
 * Maps a Simple API request to the page that answers it.
 *
 * PEP 503 addresses directories — `simple/` and `simple/<project>/` — which
 * are not object keys, so they resolve to the index stored inside. A request
 * without the trailing slash resolves the same way rather than 404ing, since
 * that is the URL a client most often types by hand.
 */
export function resolveSimplePath(
  relativePath: string,
  accept?: string,
): { objectPath: string; contentType?: string } | null {
  const path = relativePath.replace(/\/+$/, "");
  const index = prefersJson(accept)
    ? { filename: SIMPLE_JSON_FILENAME, contentType: SIMPLE_JSON_CONTENT_TYPE }
    : { filename: SIMPLE_INDEX_FILENAME, contentType: HTML_CONTENT_TYPE };

  if (path === SIMPLE_PREFIX) {
    return { objectPath: `${SIMPLE_PREFIX}/${index.filename}`, contentType: index.contentType };
  }

  const project = /^simple\/([^/]+)$/.exec(path)?.[1];
  if (project) {
    return {
      objectPath: `${SIMPLE_PREFIX}/${project}/${index.filename}`,
      contentType: index.contentType,
    };
  }

  // Anything else addresses an object directly; a trailing slash on a file
  // path is not something this format serves.
  return relativePath.endsWith("/") ? null : { objectPath: relativePath };
}

/**
 * Decides which serialization a client asked for (PEP 691).
 *
 * pip sends all three types with quality values, preferring JSON. A client
 * that says nothing, or only knows `text/html`, gets the HTML — which is what
 * every client understood before PEP 691 existed.
 */
function prefersJson(accept?: string): boolean {
  if (!accept) {
    return false;
  }

  let jsonQuality = 0;
  let htmlQuality = 0;
  for (const entry of accept.split(",")) {
    const [type = "", ...parameters] = entry.trim().split(";").map((part) => part.trim());
    const quality = Number(
      parameters.find((parameter) => parameter.startsWith("q="))?.slice(2) ?? "1",
    );
    if (!Number.isFinite(quality) || quality <= 0) {
      continue;
    }
    if (type === SIMPLE_JSON_CONTENT_TYPE) {
      jsonQuality = Math.max(jsonQuality, quality);
    } else if (type === SIMPLE_HTML_CONTENT_TYPE || type === "text/html" || type === "*/*") {
      htmlQuality = Math.max(htmlQuality, quality);
    }
  }

  return jsonQuality > 0 && jsonQuality >= htmlQuality;
}

/** Matches a stored distribution, so the packages tree can be read back. */
const packagePathPattern = new RegExp(
  `^${PACKAGES_PREFIX}/([A-Za-z0-9][A-Za-z0-9.-]*)/([^/]+)$`,
);

export function parsePackageRelativePath(
  relativePath: string,
): { normalizedName: string; filename: string } | undefined {
  const match = packagePathPattern.exec(relativePath);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }
  return { normalizedName: match[1], filename: match[2] };
}
