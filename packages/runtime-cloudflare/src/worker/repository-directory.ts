import type { RepositoryObjectStore } from "@axis-repository/core";
import type { ResolvedPluginIconAssets } from "@axis-repository/core/plugin-icons";

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
 * Icons, defined once and referenced per row.
 *
 * A pool directory can hold hundreds of files, so the shapes live in a sprite
 * and each row costs a `<use>` rather than a copy of the path data.
 */
const DIRECTORY_ICONS = `
  <symbol id="i-folder" viewBox="0 0 24 24">
    <path d="M4 7a2 2 0 0 1 2-2h3.6a2 2 0 0 1 1.4.6L12.4 7H18a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/>
  </symbol>
  <symbol id="i-package" viewBox="0 0 24 24">
    <path d="M20 8.5a1.7 1.7 0 0 0-.85-1.47l-6.3-3.6a1.7 1.7 0 0 0-1.7 0l-6.3 3.6A1.7 1.7 0 0 0 4 8.5v7a1.7 1.7 0 0 0 .85 1.47l6.3 3.6a1.7 1.7 0 0 0 1.7 0l6.3-3.6A1.7 1.7 0 0 0 20 15.5z"/>
    <path d="m4.3 7.7 7.7 4.4 7.7-4.4"/>
    <path d="M12 20.9v-8.8"/>
  </symbol>
  <symbol id="i-shield" viewBox="0 0 24 24">
    <path d="M12 3.2 5.5 5.6v5.5c0 3.8 2.6 7.1 6.5 8.4 3.9-1.3 6.5-4.6 6.5-8.4V5.6z"/>
    <path d="m9.4 11.9 1.9 1.9 3.4-3.6"/>
  </symbol>
  <symbol id="i-doc" viewBox="0 0 24 24">
    <path d="M14 3.5H7.5a1.8 1.8 0 0 0-1.8 1.8v13.4a1.8 1.8 0 0 0 1.8 1.8h9a1.8 1.8 0 0 0 1.8-1.8V7.8z"/>
    <path d="M13.8 3.6v3.9a1 1 0 0 0 1 1h3.4"/>
  </symbol>
`;

const GITHUB_URL = "https://github.com/sakkyoi/axis-repository";
const GITHUB_ICON = `<svg class="github-icon" aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.24c-3.34.73-4.04-1.42-4.04-1.42-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.08 1.84 2.82 1.31 3.51 1 .11-.78.42-1.31.76-1.61-2.66-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6.02 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.81 5.62-5.49 5.92.43.37.82 1.1.82 2.22v3.29c0 .32.21.7.83.58A12 12 0 0 0 12 .5Z"/></svg>`;
const LOVE_ICON = `<span class="love-icon" aria-label="love" role="img"><svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-6.9-4.35-9.65-8.15C.11 9.75.87 5.34 4.35 4.08 6.23 3.4 8.36 3.87 9.75 5.5L12 8.13l2.25-2.63c1.39-1.63 3.52-2.1 5.4-1.42 3.48 1.26 4.24 5.67 2 8.77C18.9 16.65 12 21 12 21Z"/></svg></span>`;

/**
 * Which icon a name gets.
 *
 * Only the distinctions a person browsing actually makes: what is a folder,
 * what is a package they might install, what carries a signature, and
 * everything else.
 */
function iconFor(entry: RepositoryDirectoryEntry): string {
  if (entry.directory) {
    return "i-folder";
  }
  const name = entry.name.toLowerCase();
  if (/\.(deb|udeb|whl|tar\.gz|tar\.xz|tgz|gz|xz|zst|bz2)$/.test(name)) {
    return "i-package";
  }
  if (/(^|\/)(inrelease|release)$/.test(name) || /\.(gpg|asc|sig)$/.test(name)) {
    return "i-shield";
  }
  return "i-doc";
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
    --ink-accent: 74 42% 28%;
    --shadow: 60 10% 40%;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --background: 0 0% 6%;
      --foreground: 60 11% 96%;
      --panel: 0 0% 9%;
      --muted-foreground: 45 6% 66%;
      --primary: 72 100% 63%;
      --border: 0 0% 20%;
      --ink-accent: 72 70% 66%;
      --shadow: 0 0% 0%;
    }
  }
  * { box-sizing: border-box; }
  .sprite { display: none; }
  body {
    margin: 0;
    min-height: 100vh;
    background:
      radial-gradient(70rem 32rem at 15% -8%, hsl(var(--primary) / 0.09), transparent 60%),
      hsl(var(--background));
    color: hsl(var(--foreground));
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: 14px;
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
  }
  header { padding: 1.75rem 1.5rem 0; }
  .brand {
    align-items: center;
    display: flex;
    gap: 1rem;
    justify-content: space-between;
    margin: 0 auto;
    max-width: 54rem;
  }
  .brand-main {
    align-items: center;
    display: flex;
    gap: 0.7rem;
    min-width: 0;
  }
  .axis-logo-mark,
  .axis-logo-mark img {
    display: block;
    flex: none;
    height: 30px;
    width: 30px;
  }
  .wordmark { font-size: 0.95rem; font-weight: 650; letter-spacing: -0.015em; }
  .repository {
    color: hsl(var(--muted-foreground));
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.75rem;
  }
  .ecosystem {
    align-items: center;
    color: hsl(var(--muted-foreground));
    display: inline-flex;
    font-size: 0.75rem;
    gap: 0.35rem;
    margin-top: 0.15rem;
  }
  .ecosystem svg {
    color: hsl(var(--primary));
    height: 1rem;
    width: 1rem;
  }
  .github-link {
    align-items: center;
    color: hsl(var(--muted-foreground));
    display: inline-flex;
    flex: none;
    font-size: 0.75rem;
    font-weight: 600;
    gap: 0.35rem;
    padding: 0.15rem 0;
    transition: color 0.15s ease;
  }
  .github-link:hover {
    color: hsl(var(--foreground));
    text-decoration: underline;
    text-decoration-color: hsl(var(--primary));
    text-underline-offset: 3px;
  }
  .github-icon {
    height: 1rem;
    width: 1rem;
  }
  main { margin: 0 auto; max-width: 54rem; padding: 1.25rem 1.5rem 3rem; }
  nav {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.8125rem;
    gap: 0.15rem;
    margin-bottom: 0.9rem;
    padding-left: 0.2rem;
  }
  nav .sep { color: hsl(var(--muted-foreground) / 0.6); }
  nav .here {
    background: hsl(var(--primary) / 0.16);
    border-radius: 999px;
    color: hsl(var(--ink-accent));
    font-weight: 600;
    padding: 0.1rem 0.55rem;
  }
  .card {
    background: hsl(var(--panel));
    border: 1px solid hsl(var(--border) / 0.85);
    border-radius: 16px;
    box-shadow: 0 1px 2px hsl(var(--shadow) / 0.06), 0 18px 36px -26px hsl(var(--shadow) / 0.5);
    overflow: hidden;
  }
  table { border-collapse: collapse; width: 100%; }
  th {
    color: hsl(var(--muted-foreground));
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.07em;
    padding: 0.7rem 1.1rem;
    text-align: left;
    text-transform: uppercase;
  }
  th:last-child { text-align: right; }
  tbody tr { border-top: 1px solid hsl(var(--border) / 0.5); }
  td { padding: 0; }
  td.size {
    color: hsl(var(--muted-foreground));
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.75rem;
    padding-right: 1.1rem;
    text-align: right;
    white-space: nowrap;
  }
  td a {
    align-items: center;
    display: flex;
    gap: 0.6rem;
    overflow-wrap: anywhere;
    padding: 0.68rem 1.1rem;
  }
  .icon {
    color: hsl(var(--muted-foreground) / 0.85);
    fill: none;
    flex: none;
    height: 18px;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.6;
    transition: transform 0.15s ease, color 0.15s ease;
    width: 18px;
  }
  /*
   * Folders are filled rather than outlined, so the shape of a listing reads
   * before any of the names do. Set on the <svg> and not on its paths: <use>
   * draws into a shadow tree that outside selectors cannot reach, and fill is
   * inherited, so this is the way in.
   */
  .is-folder .icon { color: hsl(var(--ink-accent)); fill: hsl(var(--primary) / 0.32); }
  tbody tr:hover { background: hsl(var(--primary) / 0.09); }
  tbody tr:hover .icon { color: hsl(var(--ink-accent)); transform: scale(1.12); }
  tbody tr:hover .name { text-decoration: underline; text-decoration-color: hsl(var(--primary)); text-underline-offset: 3px; }
  .name { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  /*
   * :link and :visited both, because the browser's own :visited rule outranks
   * a bare selector and would otherwise repaint half the listing purple.
   */
  a:link, a:visited { color: hsl(var(--foreground)); text-decoration: none; }
  nav a:link, nav a:visited { color: hsl(var(--muted-foreground)); padding: 0.1rem 0.2rem; }
  nav a:hover { color: hsl(var(--foreground)); }
  .empty {
    align-items: center;
    color: hsl(var(--muted-foreground));
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 3rem 1rem;
    text-align: center;
  }
  .empty .icon { color: hsl(var(--primary)); height: 30px; opacity: 0.8; width: 30px; }
  footer {
    align-items: center;
    color: hsl(var(--muted-foreground) / 0.75);
    display: flex;
    flex-wrap: wrap;
    font-size: 0.6875rem;
    gap: 0.5rem;
    justify-content: space-between;
    margin: 0 auto;
    max-width: 54rem;
    padding: 0.9rem 1.6rem 0;
  }
  .credit { color: hsl(var(--muted-foreground) / 0.85); }
  .love-icon {
    display: inline-flex;
    height: 0.8rem;
    margin-left: 0.18rem;
    vertical-align: -0.12rem;
    width: 0.8rem;
  }
`;

export function renderRepositoryDirectoryHtml(input: {
  repositoryName: string;
  repositoryEcosystem: string;
  pluginIcon: ResolvedPluginIconAssets;
  logoMarks: {
    light: string;
    dark: string;
  };
  listing: RepositoryDirectoryListing;
}): string {
  const path = `/${input.repositoryName}/${input.listing.relativePath}`;
  const rows = input.listing.entries.map((entry) => {
    // Links are relative to the listing, so the same page works whatever
    // origin or prefix the repository is reached through — and prefixed, so a
    // name carrying a colon cannot read as a scheme.
    const href = escapeHtml(relativeReference(encodeURIComponent(entry.name.replace(/\/$/, ""))
      + (entry.directory ? "/" : "")));
    return [
      `          <tr${entry.directory ? " class=\"is-folder\"" : ""}>`,
      `<td><a href="${href}">${icon(iconFor(entry))}`,
      `<span class="name">${escapeHtml(entry.name)}</span></a></td>`,
      `<td class="size">${entry.directory ? "" : formatSize(entry.size)}</td></tr>`,
    ].join("");
  });

  return [
    "<!DOCTYPE html>",
    "<html lang=\"en\">",
    "  <head>",
    "    <meta charset=\"utf-8\" />",
    "    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />",
    `    <link rel="icon" type="image/svg+xml" href="${compositeFaviconDataUrl(input.logoMarks.light, input.pluginIcon)}" media="(prefers-color-scheme: light)" />`,
    `    <link rel="icon" type="image/svg+xml" href="${compositeFaviconDataUrl(input.logoMarks.dark, input.pluginIcon)}" media="(prefers-color-scheme: dark)" />`,
    `    <title>${escapeHtml(path)} · Axis Repository</title>`,
    `    <style>${DIRECTORY_STYLES}</style>`,
    "  </head>",
    "  <body>",
    `    <svg class="sprite" aria-hidden="true">${DIRECTORY_ICONS}</svg>`,
    "    <header>",
    "      <div class=\"brand\">",
    "        <div class=\"brand-main\">",
    "          <picture class=\"axis-logo-mark\">",
    "            <source media=\"(prefers-color-scheme: dark)\" srcset=\"/logo-mark-dark.svg\" />",
    "            <img src=\"/logo-mark-light.svg\" alt=\"\" />",
    "          </picture>",
    "          <div>",
    "            <div class=\"wordmark\">Axis Repository</div>",
    `            <div class="repository">${escapeHtml(input.repositoryName)}</div>`,
    `            <div class="ecosystem" data-ecosystem="${escapeHtml(input.repositoryEcosystem)}">${input.pluginIcon.inlineSvg}<span>${escapeHtml(input.pluginIcon.title)}</span></div>`,
    "          </div>",
    "        </div>",
    `        <a class="github-link" href="${GITHUB_URL}" aria-label="Open Axis Repository on GitHub" target="_blank" rel="noreferrer">${GITHUB_ICON}<span>GitHub</span></a>`,
    "      </div>",
    "    </header>",
    "    <main>",
    `      <nav aria-label="Breadcrumb">${renderBreadcrumb(input)}</nav>`,
    "      <div class=\"card\">",
    ...(input.listing.entries.length === 0
      ? [
        "        <div class=\"empty\">",
        `          ${icon("i-folder")}`,
        "          <div>Nothing published here yet.</div>",
        "        </div>",
      ]
      : [
        "        <table>",
        "          <thead><tr><th>Name</th><th>Size</th></tr></thead>",
        "          <tbody>",
        ...(input.listing.relativePath === ""
          ? []
          : [
            "          <tr class=\"is-folder\" data-up><td><a href=\"../\">"
            + `${icon("i-folder")}<span class="name">../</span></a></td>`
            + "<td class=\"size\"></td></tr>",
          ]),
        ...rows,
        "          </tbody>",
        "        </table>",
      ]),
    "      </div>",
    "    </main>",
    `    <footer><span>${input.listing.entries.length} ${input.listing.entries.length === 1 ? "entry" : "entries"}</span><span class="credit">Made by sakkyoi with ${LOVE_ICON}</span></footer>`,
    "  </body>",
    "</html>",
    "",
  ].join("\n");
}

function compositeFaviconDataUrl(logoMarkSvg: string, pluginIcon: ResolvedPluginIconAssets): string {
  const badgeIcon = pluginIcon.inlineSvg
    .replace("<svg ", "<svg x=\"148\" y=\"148\" width=\"46\" height=\"46\" ")
    .replace("<title>", "<title>Badge: ");
  const svg = [
    "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 210 210\">",
    normalizeLogoMarkForFavicon(logoMarkSvg),
    `<circle cx="171" cy="171" r="29" fill="${escapeHtml(pluginIcon.accentColor)}" stroke="#f8fafc" stroke-width="8"/>`,
    `<g color="#f8fafc">${badgeIcon}</g>`,
    "</svg>",
  ].join("");
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function normalizeLogoMarkForFavicon(logoMarkSvg: string): string {
  const trimmed = logoMarkSvg.trim();
  const match = trimmed.match(/^<svg\b([^>]*)>/);
  if (!match) {
    return trimmed;
  }
  const attrs = match[1]!
    .replace(/\swidth="[^"]*"/, "")
    .replace(/\sheight="[^"]*"/, "");
  return `<svg${attrs} width="210" height="210">${trimmed.slice(match[0].length)}`;
}

function icon(id: string): string {
  return `<svg class="icon" aria-hidden="true"><use href="#${id}" /></svg>`;
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
  const separator = "<span class=\"sep\">/</span>";
  const crumbs = segments.map((segment, index) => {
    const up = segments.length - index - 1;
    return up === 0
      ? `<span class="here">${escapeHtml(segment)}</span>`
      : `<a href="${"../".repeat(up)}">${escapeHtml(segment)}</a>${separator}`;
  });

  const root = segments.length === 0
    ? `<span class="here">${escapeHtml(input.repositoryName)}</span>`
    : `<a href="${"../".repeat(segments.length)}">${escapeHtml(input.repositoryName)}</a>${separator}`;
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
