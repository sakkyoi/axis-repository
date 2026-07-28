/**
 * The Simple repository API, as PEP 503 defines it.
 *
 * Two kinds of page. The root lists every project, one anchor each. A project
 * page lists every file of that project, each anchor carrying the hash of what
 * it points at, so a client can tell whether what it downloaded is what the
 * index described.
 */

export const SIMPLE_INDEX_FILENAME = "index.html";
export const SIMPLE_JSON_FILENAME = "index.v1.json";
export const HTML_CONTENT_TYPE = "text/html; charset=utf-8";

/**
 * The media types the Simple API is served as.
 *
 * PEP 691 added a JSON serialization and asks clients to negotiate: pip sends
 * all three, preferring JSON. The HTML type is the same document either name
 * reaches, so the two HTML types answer identically.
 */
export const SIMPLE_JSON_CONTENT_TYPE = "application/vnd.pypi.simple.v1+json";
export const SIMPLE_HTML_CONTENT_TYPE = "application/vnd.pypi.simple.v1+html";

/** The API version both serializations declare. */
const API_VERSION = "1.0";

export interface SimpleProjectFile {
  filename: string;
  sha256: string;
  /** The `Requires-Python` marker, when the distribution declares one. */
  requiresPython?: string;
  /**
   * Digest of the core metadata published beside this file (PEP 658).
   *
   * Its presence is what tells pip it can resolve dependencies by fetching a
   * few kilobytes instead of the whole distribution.
   */
  coreMetadataSha256?: string;
  /** Why this file was yanked (PEP 592); empty string when no reason was given. */
  yanked?: string;
}

/**
 * Escapes text for HTML.
 *
 * A project name reaches here from a filename an uploader chose. Normalization
 * leaves only letters, digits, dots and dashes, so nothing dangerous survives
 * it — but the version and the requires-python marker are copied from package
 * metadata unfiltered, and `>=3.9` alone contains a character that would
 * otherwise close an attribute.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The root index, listing one anchor per project. */
export function renderProjectListHtml(projects: string[]): string {
  const anchors = [...projects]
    .sort((left, right) => left.localeCompare(right))
    .map((project) => `    <a href="${escapeHtml(project)}/">${escapeHtml(project)}</a><br />`);

  return [
    "<!DOCTYPE html>",
    "<html>",
    "  <head>",
    "    <meta name=\"pypi:repository-version\" content=\"1.0\" />",
    "    <title>Simple index</title>",
    "  </head>",
    "  <body>",
    ...anchors,
    "  </body>",
    "</html>",
    "",
  ].join("\n");
}

/**
 * One project's page.
 *
 * Links are relative and point back out of `simple/<project>/` into the
 * packages tree, so the index does not have to know the origin it is served
 * from — the same objects answer correctly however the repository is reached.
 */
export function renderProjectFilesHtml(input: {
  project: string;
  files: SimpleProjectFile[];
}): string {
  const anchors = sortedFiles(input.files).map((file) => {
    const href = fileHref(input.project, file);
    const attributes = [
      file.requiresPython ? ` data-requires-python="${escapeHtml(file.requiresPython)}"` : "",
      file.coreMetadataSha256 ? ` data-core-metadata="sha256=${file.coreMetadataSha256}"` : "",
      // An empty reason is still a yank, so this cannot test truthiness.
      file.yanked === undefined ? "" : ` data-yanked="${escapeHtml(file.yanked)}"`,
    ].join("");
    return `    <a href="${escapeHtml(href)}"${attributes}>${escapeHtml(file.filename)}</a><br />`;
  });

  return [
    "<!DOCTYPE html>",
    "<html>",
    "  <head>",
    "    <meta name=\"pypi:repository-version\" content=\"1.0\" />",
    `    <title>Links for ${escapeHtml(input.project)}</title>`,
    "  </head>",
    "  <body>",
    `    <h1>Links for ${escapeHtml(input.project)}</h1>`,
    ...anchors,
    "  </body>",
    "</html>",
    "",
  ].join("\n");
}

function sortedFiles(files: SimpleProjectFile[]): SimpleProjectFile[] {
  return [...files].sort((left, right) => left.filename.localeCompare(right.filename));
}

function fileHref(project: string, file: SimpleProjectFile): string {
  return `../../packages/${project}/${encodeURIComponent(file.filename)}#sha256=${file.sha256}`;
}

/**
 * The JSON serialization of the root index (PEP 691).
 *
 * Same content as the HTML, in the shape a client that negotiated JSON gets.
 */
export function renderProjectListJson(projects: string[]): string {
  return `${JSON.stringify({
    meta: { "api-version": API_VERSION },
    projects: [...projects]
      .sort((left, right) => left.localeCompare(right))
      .map((name) => ({ name })),
  }, null, 2)}\n`;
}

/** The JSON serialization of one project's page (PEP 691). */
export function renderProjectFilesJson(input: {
  project: string;
  files: SimpleProjectFile[];
}): string {
  return `${JSON.stringify({
    meta: { "api-version": API_VERSION },
    name: input.project,
    files: sortedFiles(input.files).map((file) => ({
      filename: file.filename,
      url: fileHref(input.project, file),
      hashes: { sha256: file.sha256 },
      ...(file.requiresPython ? { "requires-python": file.requiresPython } : {}),
      ...(file.coreMetadataSha256
        ? { "core-metadata": { sha256: file.coreMetadataSha256 } }
        : {}),
      // PEP 592 distinguishes "not yanked" from "yanked without a reason", so
      // an empty reason has to serialize as true rather than as "".
      ...(file.yanked === undefined ? {} : { yanked: file.yanked === "" ? true : file.yanked }),
    })),
  }, null, 2)}\n`;
}
