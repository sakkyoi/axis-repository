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

/**
 * Whether a listing at this URL has to be redirected to its slashed form.
 *
 * The links in a listing are relative to it, so serving one at a path without
 * its trailing slash resolves every link a level too high: `/repositories/a`
 * would link to `/repositories/Packages`.
 *
 * This reads the request path rather than the parsed repository path, because
 * parsing cannot tell `/repositories/a` from `/repositories/a/` — both name
 * the repository root.
 */
export function directoryNeedsTrailingSlash(pathname: string): boolean {
  return !pathname.endsWith("/");
}

/**
 * Where to send a directory asked for without its trailing slash.
 *
 * A relative reference rather than an absolute path, so the redirect lands in
 * the right place even when the worker is reached through a prefix it cannot
 * see — a reverse proxy mapping `/mirror/…` onto it would otherwise be sent
 * to `/repositories/a/` and lose the prefix. RFC 7231 allows this, and the
 * links in the listing itself are relative for the same reason.
 */
export function trailingSlashRedirectLocation(pathname: string, search: string): string {
  return `${relativeReference(pathname.slice(pathname.lastIndexOf("/") + 1))}/${search}`;
}

/**
 * Prefixes a relative reference so its first segment cannot read as a scheme.
 *
 * RFC 3986 reserves that reading: `pkg:1.0/` is a URI with the scheme `pkg`,
 * not a path, and a client follows it somewhere else entirely or refuses it.
 * A `./` in front settles it as a path.
 *
 * This carries the redirect, where the segment is whatever the client sent.
 * The listing's own links are percent-encoded first, which already rules the
 * colon out; the prefix is there so neither depends on that.
 */
function relativeReference(segment: string): string {
  return `./${segment}`;
}

/**
 * The design tokens the admin console uses, in the two schemes it defines.
 *
 * Copied rather than imported: this page is assembled in the worker and can
 * fetch nothing, so it carries its own styles. `packages/admin-ui/src/styles.css`
 * remains where the values are decided; these follow it.
 */
const DIRECTORY_STYLES = `
  :root {
    --background: 48 22% 96%;
    --foreground: 60 6% 9%;
    --panel: 48 33% 99%;
    --muted-foreground: 45 6% 36%;
    --primary: 72 100% 52%;
    --border: 42 14% 78%;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --background: 0 0% 6%;
      --foreground: 60 11% 96%;
      --panel: 0 0% 9%;
      --muted-foreground: 45 6% 66%;
      --primary: 72 100% 63%;
      --border: 0 0% 20%;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: hsl(var(--background));
    color: hsl(var(--foreground));
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: 14px;
    line-height: 1.5;
  }
  header {
    border-bottom: 1px solid hsl(var(--border));
    background: hsl(var(--panel));
    padding: 0.75rem 1.5rem;
  }
  .wordmark { font-weight: 600; letter-spacing: -0.01em; }
  .wordmark::before {
    content: "";
    display: inline-block;
    width: 0.5rem;
    height: 0.5rem;
    margin-right: 0.5rem;
    border-radius: 1px;
    background: hsl(var(--primary));
    vertical-align: baseline;
  }
  .repository { color: hsl(var(--muted-foreground)); font-size: 0.8125rem; }
  main { margin: 0 auto; max-width: 60rem; padding: 1.5rem; }
  nav {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.8125rem;
    margin-bottom: 1rem;
    overflow-wrap: anywhere;
  }

  nav .here { color: hsl(var(--foreground)); font-weight: 600; }
  table { border-collapse: collapse; width: 100%; }
  th {
    border-bottom: 1px solid hsl(var(--border));
    color: hsl(var(--muted-foreground));
    font-size: 0.75rem;
    font-weight: 500;
    letter-spacing: 0.04em;
    padding: 0 0.75rem 0.5rem 0;
    text-align: left;
    text-transform: uppercase;
  }
  th:last-child, td:last-child { text-align: right; padding-right: 0; }
  td {
    border-bottom: 1px solid hsl(var(--border) / 0.5);
    padding: 0.4rem 0.75rem 0.4rem 0;
  }
  tbody tr:hover td { background: hsl(var(--panel)); }
  td a {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    overflow-wrap: anywhere;
  }
  td.size {
    color: hsl(var(--muted-foreground));
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.8125rem;
    white-space: nowrap;
  }
  /*
   * :link and :visited both, because the browser's own :visited rule outranks
   * a bare selector and would otherwise repaint half the listing purple.
   */
  a:link, a:visited { color: hsl(var(--foreground)); text-decoration: none; }
  a:hover { text-decoration: underline; text-decoration-color: hsl(var(--primary)); text-underline-offset: 3px; }
  nav a:link, nav a:visited { color: hsl(var(--muted-foreground)); }
  .empty { color: hsl(var(--muted-foreground)); padding: 2rem 0; }
`;

export function renderRepositoryDirectoryHtml(input: {
  repositoryName: string;
  listing: RepositoryDirectoryListing;
}): string {
  const path = `/${input.repositoryName}/${input.listing.relativePath}`;
  const rows = input.listing.entries.map((entry) => {
    // Links are relative to the listing, so the same page works whatever
    // origin or prefix the repository is reached through — and prefixed, so a
    // name carrying a colon cannot read as a scheme.
    const href = escapeHtml(relativeReference(encodeURIComponent(entry.name.replace(/\/$/, ""))
      + (entry.directory ? "/" : "")));
    const size = entry.directory ? "" : formatSize(entry.size);
    return `          <tr><td><a href="${href}">${escapeHtml(entry.name)}</a></td>`
      + `<td class="size">${size}</td></tr>`;
  });

  return [
    "<!DOCTYPE html>",
    "<html lang=\"en\">",
    "  <head>",
    "    <meta charset=\"utf-8\" />",
    "    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />",
    `    <title>${escapeHtml(path)} · Axis Repository</title>`,
    `    <style>${DIRECTORY_STYLES}</style>`,
    "  </head>",
    "  <body>",
    "    <header>",
    "      <div class=\"wordmark\">Axis Repository</div>",
    `      <div class="repository">${escapeHtml(input.repositoryName)}</div>`,
    "    </header>",
    "    <main>",
    `      <nav aria-label="Breadcrumb">${renderBreadcrumb(input)}</nav>`,
    ...(input.listing.entries.length === 0
      ? ["      <p class=\"empty\">Nothing published here yet.</p>"]
      : [
        "      <table>",
        "        <thead><tr><th>Name</th><th>Size</th></tr></thead>",
        "        <tbody>",
        ...(input.listing.relativePath === ""
          ? []
          : ["          <tr class=\"up\"><td><a href=\"../\">../</a></td><td class=\"size\"></td></tr>"]),
        ...rows,
        "        </tbody>",
        "      </table>",
      ]),
    "    </main>",
    "  </body>",
    "</html>",
    "",
  ].join("\n");
}

/**
 * The path as clickable ancestors.
 *
 * Each link is `../` repeated, which is relative and carries no segment of
 * its own, so it survives the same prefixes and colons the entry links do.
 */
function renderBreadcrumb(input: {
  repositoryName: string;
  listing: RepositoryDirectoryListing;
}): string {
  const segments = input.listing.relativePath.split("/").filter((segment) => segment !== "");
  const crumbs = segments.map((segment, index) => {
    const up = segments.length - index - 1;
    return up === 0
      ? `<span class="here">${escapeHtml(segment)}/</span>`
      : `<a href="${"../".repeat(up)}">${escapeHtml(segment)}</a>/`;
  });

  const root = segments.length === 0
    ? `<span class="here">${escapeHtml(input.repositoryName)}/</span>`
    : `<a href="${"../".repeat(segments.length)}">${escapeHtml(input.repositoryName)}</a>/`;
  return [root, ...crumbs].join("");
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
