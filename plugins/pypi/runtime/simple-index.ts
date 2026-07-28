/**
 * The Simple repository API, as PEP 503 defines it.
 *
 * Two kinds of page. The root lists every project, one anchor each. A project
 * page lists every file of that project, each anchor carrying the hash of what
 * it points at, so a client can tell whether what it downloaded is what the
 * index described.
 */

export const SIMPLE_INDEX_FILENAME = "index.html";
export const HTML_CONTENT_TYPE = "text/html; charset=utf-8";

export interface SimpleProjectFile {
  filename: string;
  sha256: string;
  /** The `Requires-Python` marker, when the distribution declares one. */
  requiresPython?: string;
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
  const anchors = [...input.files]
    .sort((left, right) => left.filename.localeCompare(right.filename))
    .map((file) => {
      const href = `../../packages/${input.project}/${encodeURIComponent(file.filename)}#sha256=${file.sha256}`;
      const requiresPython = file.requiresPython
        ? ` data-requires-python="${escapeHtml(file.requiresPython)}"`
        : "";
      return `    <a href="${escapeHtml(href)}"${requiresPython}>${escapeHtml(file.filename)}</a><br />`;
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
