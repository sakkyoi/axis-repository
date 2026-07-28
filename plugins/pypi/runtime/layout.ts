import type { PypiDistributionFilename } from "./names";

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
 * Maps a Simple API request to the page that answers it.
 *
 * PEP 503 addresses directories — `simple/` and `simple/<project>/` — which
 * are not object keys, so they resolve to the index stored inside. A request
 * without the trailing slash resolves the same way rather than 404ing, since
 * that is the URL a client most often types by hand.
 */
export function resolveSimplePath(relativePath: string): { objectPath: string } | null {
  const path = relativePath.replace(/\/+$/, "");
  if (path === SIMPLE_PREFIX) {
    return { objectPath: `${SIMPLE_PREFIX}/index.html` };
  }

  const project = /^simple\/([^/]+)$/.exec(path)?.[1];
  if (project) {
    return { objectPath: `${SIMPLE_PREFIX}/${project}/index.html` };
  }

  // Anything else addresses an object directly; a trailing slash on a file
  // path is not something this format serves.
  return relativePath.endsWith("/") ? null : { objectPath: relativePath };
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
