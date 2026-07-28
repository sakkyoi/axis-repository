import { ValidationError } from "@axis-repository/core";

/**
 * Project and file naming, as the packaging standards define them.
 *
 * Two rules do most of the work here. A project name is compared in a
 * normalized form (PEP 503), so `Foo.Bar`, `foo_bar` and `FOO--BAR` are one
 * project and must land on one index page. And a distribution filename encodes
 * the project and version it belongs to, in a shape that differs between
 * wheels (PEP 427) and source distributions (PEP 625).
 */

/** Anything that could name a project before normalization (PEP 508). */
const projectNamePattern = /^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?$/;

/**
 * A wheel filename, as PEP 427 defines it.
 *
 * `{distribution}-{version}(-{build})?-{python}-{abi}-{platform}.whl`, where
 * the distribution and version are escaped: runs of unsafe characters become
 * a single underscore, so they never contain the `-` that separates fields.
 */
const wheelPattern = /^([^-]+)-([^-]+)(?:-(\d[^-]*))?-([^-]+)-([^-]+)-([^-]+)\.whl$/;

/**
 * A source distribution filename.
 *
 * PEP 625 settled this as `{name}-{version}.tar.gz` with the name escaped the
 * same way a wheel's is. Older sdists were built before that rule and use the
 * project's unescaped name, which may contain `-`, so the version is taken
 * from the last `-` and the rest is the name.
 */
const sdistPattern = /^(.+)-([^-]+)\.tar\.gz$/;

export type PypiDistributionKind = "wheel" | "sdist";

export interface PypiDistributionFilename {
  kind: PypiDistributionKind;
  /** The project name exactly as the filename spells it. */
  rawName: string;
  /** The project name in the form its index page is keyed by. */
  normalizedName: string;
  version: string;
}

/**
 * Reduces a project name to the single form everything else compares against.
 *
 * PEP 503: runs of `-`, `_` and `.` collapse to one `-`, and the result is
 * lowercased. Without this the same project reaches pip under as many names as
 * its files happen to be spelled, and each spelling gets its own page.
 */
export function normalizeProjectName(name: string): string {
  return name.replace(/[-_.]+/g, "-").toLowerCase();
}

export function isValidProjectName(name: string): boolean {
  return projectNamePattern.test(name);
}

/**
 * Reads the project and version out of a distribution filename.
 *
 * Returns undefined rather than throwing so callers can distinguish "not a
 * distribution" from "a malformed one"; {@link requireDistributionFilename}
 * turns the second into a rejected publish.
 */
export function parseDistributionFilename(
  filename: string,
): PypiDistributionFilename | undefined {
  const wheel = wheelPattern.exec(filename);
  if (wheel?.[1] && wheel[2]) {
    return distribution("wheel", wheel[1], wheel[2]);
  }

  const sdist = sdistPattern.exec(filename);
  if (sdist?.[1] && sdist[2]) {
    return distribution("sdist", sdist[1], sdist[2]);
  }

  return undefined;
}

function distribution(
  kind: PypiDistributionKind,
  rawName: string,
  version: string,
): PypiDistributionFilename | undefined {
  // Escaping a name replaces unsafe runs with `_`, which normalization folds
  // to `-` anyway, so the escaped and unescaped spellings agree here.
  const normalizedName = normalizeProjectName(rawName);
  // A name that normalizes to nothing, or to something that cannot be a path
  // segment, would otherwise become an index page nobody can address.
  if (!normalizedName || !isValidProjectName(normalizedName) || version === "") {
    return undefined;
  }
  return { kind, rawName, normalizedName, version };
}

export function requireDistributionFilename(filename: string): PypiDistributionFilename {
  const parsed = parseDistributionFilename(filename);
  if (!parsed) {
    throw new ValidationError(
      `PyPI artifact filename is not a wheel or source distribution: ${filename}`,
    );
  }
  return parsed;
}
