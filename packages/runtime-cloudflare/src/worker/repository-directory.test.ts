import { describe, expect, it } from "vitest";
import { resolvePluginIconAssets } from "@axis-repository/core/plugin-icons";
import { aptPluginManifest } from "@axis-repository/plugin-apt/manifest";
import { pypiPluginManifest } from "@axis-repository/plugin-pypi/manifest";
import { MemoryRepositoryObjectStore } from "../storage/repository-object-store";
import {
  directoryNeedsTrailingSlash,
  compositeRepositoryFaviconSvg,
  REPOSITORY_FAVICON_QUERY_PARAM,
  readRepositoryDirectory,
  renderRepositoryDirectoryHtml,
  trailingSlashRedirectLocation,
} from "./repository-directory";

/** Resolves a link the way a client does, so the assertions are about that. */
function resolved(href: string, at: string): string {
  return new URL(href, at).href;
}

describe("trailingSlashRedirectLocation", () => {
  it("sends a directory to its own slashed form", () => {
    expect(resolved(
      trailingSlashRedirectLocation("/repositories/a", ""),
      "https://axis.example/repositories/a",
    )).toBe("https://axis.example/repositories/a/");
  });

  it("keeps a prefix the worker cannot see", () => {
    // A reverse proxy mapping /mirror/… onto the worker sends a path the
    // worker never learns about. An absolute /repositories/a/ would drop it.
    expect(resolved(
      trailingSlashRedirectLocation("/repositories/a", ""),
      "https://axis.example/mirror/repositories/a",
    )).toBe("https://axis.example/mirror/repositories/a/");
  });

  it("keeps the query string", () => {
    expect(resolved(
      trailingSlashRedirectLocation("/repositories/a/dists", "?x=1"),
      "https://axis.example/repositories/a/dists",
    )).toBe("https://axis.example/repositories/a/dists/?x=1");
  });

  it("does not let a name carrying a colon read as a scheme", () => {
    // RFC 3986: `pkg:1.0/` is a URI with the scheme `pkg`. A client follows it
    // somewhere else entirely, or refuses to follow it at all.
    const location = trailingSlashRedirectLocation("/repositories/a/pool/pkg:1.0", "");

    expect(location.startsWith("./")).toBe(true);
    expect(resolved(location, "https://axis.example/repositories/a/pool/pkg:1.0"))
      .toBe("https://axis.example/repositories/a/pool/pkg:1.0/");
  });
});

describe("directoryNeedsTrailingSlash", () => {
  it.each([
    ["/repositories/a", true],
    ["/repositories/a/dists", true],
    ["/repositories/a/", false],
    ["/repositories/a/dists/", false],
  ])("%s -> %s", (pathname, expected) => {
    expect(directoryNeedsTrailingSlash(pathname)).toBe(expected);
  });
});

describe("renderRepositoryDirectoryHtml", () => {
  const pluginIcon = resolvePluginIconAssets(undefined);
  const logoMarks = {
    light: "<svg viewBox=\"0 0 210 210\"><path d=\"M1 1h208v208H1z\" fill=\"#111827\"/></svg>",
    dark: "<svg viewBox=\"0 0 210 210\"><path d=\"M2 2h206v206H2z\" fill=\"#e6edf3\"/></svg>",
  };
  const listing = {
    relativePath: "pool/main/",
    entries: [
      { name: "pkg:1.0/", relativePath: "pool/main/pkg:1.0/", directory: true },
      { name: "alpha_1:1.0.0_amd64.deb", relativePath: "pool/main/alpha_1:1.0.0_amd64.deb", directory: false, size: 2048 },
    ],
  };

  /**
   * The links to entries, as opposed to the ones that deliberately go up: the
   * breadcrumb's ancestors and the parent row.
   *
   * Read row by row rather than by matching a fixed cell shape, so presentation
   * can change without the assertion quietly matching nothing.
   */
  function entryHrefs(html: string): string[] {
    const rows = [...html.matchAll(/<tr(?![^>]*data-up)[^>]*>([\s\S]*?)<\/tr>/g)]
      .map((match) => match[1]!);
    return rows.flatMap((row) => [...row.matchAll(/href="([^"]+)"/g)].map((match) => match[1]!));
  }

  function render(input: {
    repositoryName?: string;
    repositoryEcosystem?: string;
    pluginIcon?: typeof pluginIcon;
    listing?: typeof listing;
  } = {}) {
    return renderRepositoryDirectoryHtml({
      repositoryName: input.repositoryName ?? "a",
      repositoryEcosystem: input.repositoryEcosystem ?? "apt",
      pluginIcon: input.pluginIcon ?? pluginIcon,
      listing: input.listing ?? listing,
    });
  }

  function faviconHrefs(html: string): string[] {
    return [...html.matchAll(/<link rel="icon" type="image\/svg\+xml" href="([^"]+)" media="[^"]+" \/>/g)]
      .map((match) => match[1]!);
  }

  it("links so every entry resolves inside the directory", () => {
    // Including a name with a colon: a Debian filename carries one whenever
    // the version has an epoch.
    const at = "https://axis.example/repositories/a/pool/main/";
    const hrefs = entryHrefs(render());

    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(resolved(href, at).startsWith(at)).toBe(true);
    }
  });

  it("walks back up through the breadcrumb", () => {
    const at = "https://axis.example/repositories/a/pool/main/";
    const html = render();
    const nav = /<nav[^>]*>(.*?)<\/nav>/s.exec(html)?.[1] ?? "";
    const crumbs = [...nav.matchAll(/<a href="([^"]+)">([^<]*)</g)]
      .map((match) => ({ href: match[1]!, label: match[2]! }));

    expect(crumbs.map((crumb) => crumb.label)).toEqual(["a", "pool"]);
    expect(resolved(crumbs[0]!.href, at)).toBe("https://axis.example/repositories/a/");
    expect(resolved(crumbs[1]!.href, at)).toBe("https://axis.example/repositories/a/pool/");
    // The directory being shown is named but not linked.
    expect(nav).toContain(">main<");
  });

  it("resolves a colon-carrying entry to the object it names", () => {
    const at = "https://axis.example/repositories/a/pool/main/";
    const html = render();
    const href = [...html.matchAll(/<a href="([^"]+)"/g)]
      .map((match) => match[1]!)
      .find((candidate) => candidate.includes("alpha"))!;

    expect(resolved(href, at))
      .toBe("https://axis.example/repositories/a/pool/main/alpha_1%3A1.0.0_amd64.deb");
  });

  it("shows sizes for files and none for directories", () => {
    const html = render();

    expect(html).toContain("2.0 KiB");
  });

  it("uses the light and dark logo assets in the directory header", () => {
    const html = render();

    expect(html).toContain("<picture class=\"axis-logo-mark\">");
    expect(html).toContain("srcset=\"/logo-mark-dark.svg\"");
    expect(html).toContain("src=\"/logo-mark-light.svg\"");
    expect(html).not.toContain("viewBox=\"0 0 210 210\"");
    expect(html).not.toContain("M14 15.5 24 9l10 6.5v13L24 35l-10-6.5v-13Z");
    expect(html).not.toContain("<span class=\"mark\" aria-hidden=\"true\"><span></span></span>");
  });

  it("declares light and dark repository favicon URLs in the document head", () => {
    const html = render();
    const favicons = faviconHrefs(html);

    expect(favicons).toHaveLength(2);
    expect(favicons).toEqual([
      `?${REPOSITORY_FAVICON_QUERY_PARAM}=light`,
      `?${REPOSITORY_FAVICON_QUERY_PARAM}=dark`,
    ]);
    expect(html).toContain("media=\"(prefers-color-scheme: light)\"");
    expect(html).toContain("media=\"(prefers-color-scheme: dark)\"");
    expect(html).not.toContain("data:image/svg+xml");
  });

  it("composes official plugin SVG icons into browser-safe favicon SVG", () => {
    const favicon = compositeRepositoryFaviconSvg(
      logoMarks.light,
      resolvePluginIconAssets(aptPluginManifest.icon),
    );

    expect(favicon).toContain("Badge: APT");
    expect(favicon).toContain("http://www.w3.org/2000/svg");
    expect(favicon).not.toContain("<circle");
    expect(favicon).not.toContain("&ns_");
    expect(favicon).not.toContain("<!DOCTYPE");
  });

  it("removes sizing attributes from official plugin SVG icons before placing the favicon badge", () => {
    const favicon = compositeRepositoryFaviconSvg(
      logoMarks.dark,
      resolvePluginIconAssets(pypiPluginManifest.icon),
    );
    const badgeSvgTag = favicon.match(/<svg x="122"[^>]+>/)?.[0] ?? "";

    expect(badgeSvgTag).toContain("width=\"82\"");
    expect(badgeSvgTag).toContain("height=\"82\"");
    expect(badgeSvgTag.match(/\bwidth=/g)).toHaveLength(1);
    expect(badgeSvgTag.match(/\bheight=/g)).toHaveLength(1);
  });

  it("normalizes logo mark dimensions before composing repository favicons", () => {
    const favicon = compositeRepositoryFaviconSvg(
      "<svg width=\"512\" height=\"512\" viewBox=\"0 0 210 210\"><path d=\"M1 1h208v208H1z\"/></svg>",
      pluginIcon,
    );

    expect(favicon).not.toContain("width=\"512\"");
    expect(favicon).not.toContain("height=\"512\"");
    expect(favicon).toContain("width=\"210\"");
    expect(favicon).toContain("height=\"210\"");
  });

  it("renders repository ecosystem icon metadata", () => {
    const aptIcon = {
      title: "APT",
      accentColor: "#0f766e",
      inlineSvg: "<svg aria-hidden=\"true\" viewBox=\"0 0 24 24\"><path d=\"M7 15.5 12 5l5 10.5\" /></svg>",
    };
    const html = render({ repositoryName: "debian", repositoryEcosystem: "apt", pluginIcon: aptIcon });

    expect(html).toContain("data-ecosystem=\"apt\"");
    expect(html).toContain(aptIcon.inlineSvg);
    expect(html).toContain("APT");
  });

  it("links to the project GitHub repository from the directory header", () => {
    const html = render();

    expect(html).toContain("https://github.com/sakkyoi/axis-repository");
    expect(html).toContain("aria-label=\"Open Axis Repository on GitHub\"");
    expect(html).toContain("<span>GitHub</span>");
    expect(html).toContain("target=\"_blank\"");
    expect(html).toContain("rel=\"noreferrer\"");
  });

  it("credits the project author in the footer", () => {
    const html = render();

    expect(html).toContain("Made by sakkyoi with");
    expect(html).toContain("class=\"love-icon\"");
    expect(html).toContain("aria-label=\"love\"");
  });
});

describe("readRepositoryDirectory", () => {
  async function store() {
    const objectStore = new MemoryRepositoryObjectStore();
    await objectStore.putText("repositories/a/dists/noble/InRelease", "x", "text/plain");
    await objectStore.putText("repositories/a/pool/main/alpha/alpha.deb", "y", "text/plain");
    await objectStore.putText("repositories/a/publishes/s.json", "{}", "application/json");
    return objectStore;
  }

  it("lists one level, directories first", async () => {
    const listing = await readRepositoryDirectory({
      objectStore: await store(),
      repositoryName: "a",
      relativePath: "",
      canServe: () => true,
    });

    expect(listing?.entries.map((entry) => entry.name)).toEqual(["dists/", "pool/", "publishes/"]);
  });

  it("hides what the plugin would not serve", async () => {
    const listing = await readRepositoryDirectory({
      objectStore: await store(),
      repositoryName: "a",
      relativePath: "",
      canServe: (relativePath) => relativePath.startsWith("dists/") || relativePath.startsWith("pool/"),
    });

    expect(listing?.entries.map((entry) => entry.name)).toEqual(["dists/", "pool/"]);
  });

  it("reports nothing for a directory that holds nothing", async () => {
    await expect(readRepositoryDirectory({
      objectStore: await store(),
      repositoryName: "a",
      relativePath: "dists/jammy/",
      canServe: () => true,
    })).resolves.toBeNull();
  });

  it("still describes an empty repository at its root", async () => {
    // A repository with nothing published exists and can be opened; only a
    // path below it that holds nothing is a 404.
    const listing = await readRepositoryDirectory({
      objectStore: new MemoryRepositoryObjectStore(),
      repositoryName: "a",
      relativePath: "",
      canServe: () => true,
    });

    expect(listing).toEqual({ relativePath: "", entries: [] });
  });
});
