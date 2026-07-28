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

const AXIS_LOGO_MARK = `<svg class="axis-logo-mark" aria-hidden="true" viewBox="0 0 210 210" fill="none" color="#111827" xmlns="http://www.w3.org/2000/svg"><g transform="matrix(1.2673431,0,0,1.2673431,-22.544142,-0.87364149)"><path fill="currentColor" d="m 109.17125,138.44315 c -5.23204,-7.36331 -13.319808,-12.93782 -23.431868,-16.15044 -2.332425,-0.74102 -8.132464,-2.1052 -10.717866,-2.52088 l -1.637163,-0.26322 0.571295,-0.70649 c 1.400258,-1.7316 3.35334,-4.84692 4.353585,-6.94431 2.528464,-5.30186 3.721021,-9.08909 7.178831,-22.798005 2.305743,-9.141399 2.982085,-11.506598 4.089033,-14.299536 0.355621,-0.897267 0.646584,-1.664223 0.646584,-1.704346 0,-0.04012 -1.135088,-0.132352 -2.522418,-0.204953 -6.532864,-0.341876 -11.209748,-3.0136 -14.521557,-8.29561 -0.892512,-1.423469 -2.024137,-4.358873 -2.330339,-6.044837 l -0.152705,-0.840807 h 3.935396 c 6.680684,0 11.088914,0.938677 15.591623,3.320036 1.894687,1.002048 4.800013,3.083952 5.642081,4.04301 0.36497,0.415682 0.73061,0.688756 0.81254,0.606833 0.3667,-0.366709 -1.288761,-2.819465 -3.203287,-4.746019 C 90.749695,58.151133 89.13365,57.374423 81.189157,54.98869 69.985064,51.624099 65.107315,49.434558 59.538841,45.270222 54.95925,41.845414 51.256975,37.512053 48.964996,32.893966 c -2.49276,-5.022638 -3.463771,-9.179942 -3.430195,-14.686079 0.0285,-4.673341 0.856184,-9.0829909 2.16737,-11.5470689 l 0.477237,-0.89686 0.150081,4.035869 c 0.168475,4.5304959 0.45495,7.1303379 1.111774,10.0896719 0.948422,4.273137 2.638481,8.275822 4.968764,11.767866 1.868285,2.799717 7.105468,7.707842 9.000583,8.435066 0.318659,0.122281 0.320007,0.04371 0.01412,-0.823258 -1.372028,-3.888742 -1.748886,-10.317726 -0.81209,-13.853797 0.486373,-1.835883 1.56611,-4.283788 1.596753,-3.62005 0.322462,6.984574 1.33381,11.488528 3.545145,15.788008 3.909999,7.602179 10.752206,12.372012 21.896246,15.264292 6.085868,1.579502 9.851158,1.848442 11.364186,0.811699 3.13233,-2.146307 3.58595,-7.198198 1.23656,-13.7715 -0.42722,-1.195281 -0.69592,-2.173238 -0.59713,-2.173238 0.37998,0 2.26777,1.746878 3.36425,3.113107 2.30136,2.867549 3.40833,5.882092 3.42636,9.330822 0.0145,2.781206 -0.33627,4.050934 -2.02877,7.34304 -0.0476,0.09249 0.0251,0.16816 0.16145,0.16816 0.37826,0 2.2221,-1.776002 2.96528,-2.856188 0.41405,-0.60179 1.07803,-1.171984 1.77751,-1.52644 3.06138,-1.551317 4.70016,-4.567828 4.67913,-8.612891 -0.007,-1.483614 -0.50065,-4.424454 -1.01379,-6.048339 l -0.17257,-0.546127 0.7189,0.511907 c 2.15148,1.531993 4.26241,5.804676 4.60689,9.324729 0.34478,3.523162 -1.48976,7.811112 -4.12246,9.635576 -0.49778,0.344955 -0.90505,0.701282 -0.90505,0.791837 0,0.09056 0.78196,0.441643 1.73768,0.780192 4.63932,1.643418 8.2484,3.765988 10.7247,6.307416 1.51739,1.557298 1.87258,1.78751 5.2884,3.427622 2.01396,0.96701 5.12476,2.383398 6.91287,3.147531 4.28938,1.833024 6.51983,2.95374 6.81039,3.421953 0.63215,1.01865 -1.09195,5.261151 -3.01481,7.418546 -1.80962,2.030357 -2.69105,2.34377 -7.72728,2.747631 -9.02115,0.723416 -14.99067,1.701277 -16.78475,2.749502 -1.31521,0.768435 -1.59576,1.431896 -1.56593,3.703226 0.0352,2.67907 0.30581,4.04354 1.79677,9.059091 1.62948,5.48158 2.03857,7.40585 2.36354,11.11735 0.69235,7.90781 -1.42727,15.77143 -6.13014,22.74239 -1.23387,1.82893 -4.3671,5.66301 -4.62785,5.66301 -0.0938,0 -0.86954,-0.98374 -1.72387,-2.18609 z m -0.69797,-24.31223 c 1.86293,-1.00907 3.46126,-1.94236 3.55186,-2.07398 0.0906,-0.13162 0.16628,-1.97636 0.16817,-4.09941 l 0.003,-3.8601 -1.62555,-0.89824 c -0.89406,-0.49402 -2.53887,-1.37356 -3.65514,-1.95452 l -2.02958,-1.0563 -3.46056,1.85117 c -1.903308,1.01815 -3.536108,1.96993 -3.628418,2.11508 -0.0923,0.14515 -0.16939,1.9383 -0.17129,3.98476 -0.003,3.26511 0.0446,3.76322 0.38895,4.06674 0.45098,0.39756 6.568728,3.73709 6.870688,3.75055 0.11017,0.005 1.72452,-0.81667 3.58744,-1.82575 z" /><path fill="#a3e635" d="m 108.47328,114.13092 c 1.86293,-1.00907 3.46126,-1.94236 3.55186,-2.07398 0.0906,-0.13162 0.16628,-1.97636 0.16817,-4.09941 l 0.003,-3.8601 -1.62555,-0.89824 c -0.89406,-0.49402 -2.53887,-1.37356 -3.65514,-1.95452 l -2.02958,-1.0563 -3.46056,1.85117 c -1.903308,1.01815 -3.536108,1.96993 -3.628418,2.11508 -0.0923,0.14515 -0.16939,1.9383 -0.17129,3.98476 -0.003,3.26511 0.0446,3.76322 0.38895,4.06674 0.45098,0.39756 6.568728,3.73709 6.870688,3.75055 0.11017,0.005 1.72452,-0.81667 3.58744,-1.82575 z" /></g></svg>`;

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
    gap: 0.7rem;
    margin: 0 auto;
    max-width: 54rem;
  }
  .axis-logo-mark {
    color: hsl(var(--foreground));
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
    color: hsl(var(--muted-foreground) / 0.75);
    font-size: 0.6875rem;
    margin: 0 auto;
    max-width: 54rem;
    padding: 0.9rem 1.6rem 0;
  }
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
    `    <title>${escapeHtml(path)} · Axis Repository</title>`,
    `    <style>${DIRECTORY_STYLES}</style>`,
    "  </head>",
    "  <body>",
    `    <svg class="sprite" aria-hidden="true">${DIRECTORY_ICONS}</svg>`,
    "    <header>",
    "      <div class=\"brand\">",
    `        ${AXIS_LOGO_MARK}`,
    "        <div>",
    "          <div class=\"wordmark\">Axis Repository</div>",
    `          <div class="repository">${escapeHtml(input.repositoryName)}</div>`,
    "        </div>",
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
    `    <footer>${input.listing.entries.length} ${input.listing.entries.length === 1 ? "entry" : "entries"}</footer>`,
    "  </body>",
    "</html>",
    "",
  ].join("\n");
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
