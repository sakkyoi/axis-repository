import type { RepositoryObjectStore } from "@axis-repository/core";

/**
 * Browsable listings for the repository tree.
 *
 * A repository is a set of object keys, so opening one in a browser used to
 * answer 404 with a JSON error for every path that was not a file. Anyone
 * looking at what a repository actually holds had to already know the key.
 *
 * The listings are generated on demand and never stored: the tree is whatever
 * the objects say it is, so there is nothing to keep in step.
 */

export interface RepositoryDirectoryEntry {
  /** Displayed name, with a trailing slash for a directory. */
  name: string;
  /** Path relative to the repository, for the link. */
  relativePath: string;
  directory: boolean;
  size?: number;
}

export interface RepositoryDirectoryListing {
  relativePath: string;
  entries: RepositoryDirectoryEntry[];
}

/**
 * Lists one level of the tree.
 *
 * `canServe` decides what appears: a listing must never show more than the
 * plugin would hand out, or browsing becomes a way around the rules about
 * which paths a repository serves.
 */
export async function readRepositoryDirectory(input: {
  objectStore: RepositoryObjectStore;
  repositoryName: string;
  /** Repository-relative, ending in "/" — or "" for the repository root. */
  relativePath: string;
  canServe: (relativePath: string) => boolean;
}): Promise<RepositoryDirectoryListing | null> {
  const base = `repositories/${input.repositoryName}/`;
  const page = await input.objectStore.listObjects({
    prefix: `${base}${input.relativePath}`,
    delimiter: "/",
  });

  const entries: RepositoryDirectoryEntry[] = [];
  for (const directory of page.directories) {
    const relativePath = directory.path.slice(base.length);
    if (input.canServe(relativePath)) {
      entries.push({ name: trailingName(relativePath, true), relativePath, directory: true });
    }
  }
  for (const object of page.objects) {
    const relativePath = object.key.slice(base.length);
    if (input.canServe(relativePath)) {
      entries.push({
        name: trailingName(relativePath, false),
        relativePath,
        directory: false,
        ...(object.contentLength !== undefined ? { size: object.contentLength } : {}),
      });
    }
  }

  // An empty listing for a path nobody published to is a 404, not a blank
  // page; the repository root is the exception, since a new repository has
  // nothing in it yet and still exists.
  if (entries.length === 0 && input.relativePath !== "") {
    return null;
  }

  entries.sort((left, right) => Number(right.directory) - Number(left.directory)
    || left.name.localeCompare(right.name));
  return { relativePath: input.relativePath, entries };
}

function trailingName(relativePath: string, directory: boolean): string {
  const segments = relativePath.replace(/\/+$/, "").split("/");
  return `${segments[segments.length - 1] ?? relativePath}${directory ? "/" : ""}`;
}

export function renderRepositoryDirectoryHtml(input: {
  repositoryName: string;
  listing: RepositoryDirectoryListing;
}): string {
  const path = `/${input.repositoryName}/${input.listing.relativePath}`;
  const rows = input.listing.entries.map((entry) => {
    // Links are relative to the listing, so the same page works whatever
    // origin or prefix the repository is reached through.
    const href = escapeHtml(encodeURI(entry.name));
    const size = entry.directory ? "" : formatSize(entry.size);
    return `      <tr><td><a href="${href}">${escapeHtml(entry.name)}</a></td><td>${size}</td></tr>`;
  });

  return [
    "<!DOCTYPE html>",
    "<html lang=\"en\">",
    "  <head>",
    "    <meta charset=\"utf-8\" />",
    "    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />",
    `    <title>Index of ${escapeHtml(path)}</title>`,
    "    <style>",
    "      body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin: 2rem; }",
    "      h1 { font-size: 1rem; font-weight: 600; margin-bottom: 1rem; }",
    "      table { border-collapse: collapse; }",
    "      td { padding: 0.15rem 1.5rem 0.15rem 0; }",
    "      td:last-child { text-align: right; color: #666; }",
    "      a { text-decoration: none; }",
    "      a:hover { text-decoration: underline; }",
    "      @media (prefers-color-scheme: dark) {",
    "        body { background: #111; color: #ddd; }",
    "        a { color: #7db3ff; }",
    "        td:last-child { color: #999; }",
    "      }",
    "    </style>",
    "  </head>",
    "  <body>",
    `    <h1>Index of ${escapeHtml(path)}</h1>`,
    "    <table>",
    ...(input.listing.relativePath === "" ? [] : ["      <tr><td><a href=\"../\">../</a></td><td></td></tr>"]),
    ...rows,
    "    </table>",
    "  </body>",
    "</html>",
    "",
  ].join("\n");
}

function formatSize(size: number | undefined): string {
  if (size === undefined) {
    return "";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = size / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
