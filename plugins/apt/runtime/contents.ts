import { stanzaField, type DebianStanza } from "../shared/stanza";

/**
 * The file lists behind one `<component>/Contents-<arch>.gz`, keyed by the
 * qualified package name that appears in the index's second column.
 */
export type AptContentsIndex = Map<string, string[]>;

/** Every `Contents-<arch>` of one suite, keyed the same way as its `Packages`. */
export type AptContentsIndexes = Map<string, AptContentsIndex>;

/**
 * Names a package the way `Contents` does: `<section>/<package>`, with the
 * component in front for anything outside `main`.
 */
export function qualifiedContentsName(input: {
  packageName: string;
  component: string;
  section?: string | undefined;
}): string {
  const section = input.section && input.section.length > 0 ? input.section : "misc";
  return input.component === "main"
    ? `${section}/${input.packageName}`
    : `${input.component}/${section}/${input.packageName}`;
}

export function contentsNameForStanza(stanza: DebianStanza, component: string): string | undefined {
  const packageName = stanzaField(stanza, "Package");
  if (packageName === undefined) {
    return undefined;
  }
  return qualifiedContentsName({ packageName, component, section: stanzaField(stanza, "Section") });
}

/**
 * Reads a published `Contents` index back into per-package file lists.
 *
 * The file is stored as `path` then the packages owning it, so recovering
 * "which files does this package install" means inverting it. That is what
 * lets a publish keep the entries of packages it did not touch without
 * re-reading their `.deb`.
 */
export function parseContentsIndex(text: string): AptContentsIndex {
  const contents: AptContentsIndex = new Map();

  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    // Paths may contain spaces, so the package column is what follows the
    // last run of whitespace rather than the second field from the left.
    const separator = /\s+(?=\S+$)/.exec(line);
    if (!separator || separator.index === 0) {
      continue;
    }
    const path = line.slice(0, separator.index);
    for (const name of line.slice(separator.index + separator[0].length).split(",")) {
      if (name === "") {
        continue;
      }
      const paths = contents.get(name) ?? [];
      paths.push(path);
      contents.set(name, paths);
    }
  }

  return contents;
}

export function formatContentsIndex(contents: AptContentsIndex): string | undefined {
  const owners = new Map<string, string[]>();

  for (const [name, paths] of contents) {
    for (const path of paths) {
      const names = owners.get(path) ?? [];
      names.push(name);
      owners.set(path, names);
    }
  }
  if (owners.size === 0) {
    return undefined;
  }

  return `${[...owners.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, names]) => `${path} ${[...new Set(names)].sort((a, b) => a.localeCompare(b)).join(",")}`)
    .join("\n")}\n`;
}

/**
 * Applies a publish to the stored file lists, then drops what the indexes no
 * longer mention.
 *
 * A package republished at a new version installs a different set of files, so
 * an incoming list replaces rather than adds to what was there. Pruning
 * against the published stanzas is what stops `Contents` outliving the
 * packages it describes.
 */
export function mergeContentsIndex(input: {
  existing: AptContentsIndex | undefined;
  incoming: AptContentsIndex;
  keepNames: Set<string>;
}): AptContentsIndex {
  const merged: AptContentsIndex = new Map();

  for (const [name, paths] of input.existing ?? []) {
    if (input.keepNames.has(name)) {
      merged.set(name, [...paths]);
    }
  }
  for (const [name, paths] of input.incoming) {
    if (input.keepNames.has(name)) {
      merged.set(name, [...paths]);
    }
  }

  return merged;
}
