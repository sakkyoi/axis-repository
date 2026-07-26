import { formatStanza, stanzaField, type DebianStanza } from "../shared/stanza";
import type { AptResolvedRepositoryConfig } from "./config";
import { formatContentsIndex, type AptContentsIndexes } from "./contents";
import { descriptionDigest, gzip, indexKey, type AptPackageIndex } from "./packages";
import { formatSourcesIndex } from "./sources";

export const TEXT_CONTENT_TYPE = "text/plain; charset=utf-8";
export const GZIP_CONTENT_TYPE = "application/gzip";

/**
 * One file published under `dists/<codename>/` and listed in `Release`.
 *
 * Every index apt can ask for — `Packages`, `Translation-en`, and their
 * compressed forms — reduces to this, so `Release` can checksum them all the
 * same way and the writer does not need to know what any of them mean.
 */
export interface AptIndexFile {
  /** Path relative to `dists/<codename>/`, exactly as `Release` lists it. */
  relativePath: string;
  bytes: Uint8Array;
  contentType: string;
  /** Set for the uncompressed forms, so they are stored as text. */
  text?: string;
}

const textEncoder = new TextEncoder();

export async function buildAptIndexFiles(input: {
  config: AptResolvedRepositoryConfig;
  packageIndexes: AptPackageIndex[];
  contentsByIndex?: AptContentsIndexes;
  sourcesByComponent?: Map<string, DebianStanza[]>;
}): Promise<AptIndexFile[]> {
  const files: AptIndexFile[] = [];

  for (const packageIndex of input.packageIndexes) {
    files.push(...await compressedVariants(packageIndex.relativePath, packageIndex.packages));

    const contents = formatContentsIndex(
      input.contentsByIndex?.get(indexKey(packageIndex.component, packageIndex.architecture, packageIndex.installer))
        ?? new Map<string, string[]>(),
    );
    if (contents !== undefined) {
      files.push(await gzipOnlyVariant(
        `${packageIndex.component}/Contents-${packageIndex.architecture}`,
        contents,
      ));
    }
  }

  for (const component of input.config.components) {
    const sources = formatSourcesIndex(input.sourcesByComponent?.get(component) ?? []);
    if (sources !== undefined) {
      files.push(...await compressedVariants(`${component}/source/Sources`, sources));
    }

    const translation = buildTranslationIndex(
      input.packageIndexes.filter((packageIndex) => packageIndex.component === component),
    );
    if (translation !== undefined) {
      files.push(...await compressedVariants(`${component}/i18n/Translation-en`, translation));
    }
  }

  return files;
}

/** Emits a file alongside its gzip form, which apt prefers when offered. */
export async function compressedVariants(relativePath: string, text: string): Promise<AptIndexFile[]> {
  const bytes = textEncoder.encode(text);
  return [
    { relativePath, bytes, contentType: TEXT_CONTENT_TYPE, text },
    { relativePath: `${relativePath}.gz`, bytes: await gzip(bytes), contentType: GZIP_CONTENT_TYPE },
  ];
}

/**
 * Emits only the gzip form, which is how `Contents` is published.
 *
 * It lists every path of every package, so it is the one index that can dwarf
 * the packages it describes; storing the plain form alongside would roughly
 * double a repository's index storage for a file no client asks for.
 */
export async function gzipOnlyVariant(relativePath: string, text: string): Promise<AptIndexFile> {
  return {
    relativePath: `${relativePath}.gz`,
    bytes: await gzip(textEncoder.encode(text)),
    contentType: GZIP_CONTENT_TYPE,
  };
}

/**
 * Builds the English translation index for one component.
 *
 * apt looks a package's description up here by `Description-md5`, so the same
 * description shared by several architectures needs only one stanza. The
 * description also stays in `Packages`, which costs some bytes but means a
 * client that never fetches translations still shows the long form.
 */
export function buildTranslationIndex(packageIndexes: AptPackageIndex[]): string | undefined {
  const stanzas = new Map<string, DebianStanza>();

  for (const packageIndex of packageIndexes) {
    for (const stanza of packageIndex.stanzas) {
      const packageName = stanzaField(stanza, "Package");
      const description = stanzaField(stanza, "Description");
      if (packageName === undefined || description === undefined) {
        continue;
      }
      const digest = stanzaField(stanza, "Description-md5") ?? descriptionDigest(description);
      const key = `${packageName}\0${digest}`;
      if (!stanzas.has(key)) {
        stanzas.set(key, [
          { name: "Package", value: packageName },
          { name: "Description-md5", value: digest },
          { name: "Description-en", value: description },
        ]);
      }
    }
  }

  if (stanzas.size === 0) {
    return undefined;
  }

  return [...stanzas.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, stanza]) => formatStanza(stanza))
    .join("\n");
}
