import type {
  PublishedObject,
  RepositoryObjectMetadata,
  RepositoryObjectStore,
} from "@axis-repository/core";
import { listAllObjects, objectBytes } from "@axis-repository/runtime-cloudflare/plugin-runtime";
import { parseStanzas } from "../shared/stanza";
import { digestHex } from "./digest";
import type { AptIndexMetadata } from "./metadata";
import { indexKey, type AptIndexStanzas, type AptPackageIndex, type AptPoolCopy } from "./packages";
import { acquireByHashEnabled } from "./release";

export const TEXT_CONTENT_TYPE = "text/plain; charset=utf-8";
export const GZIP_CONTENT_TYPE = "application/gzip";
export const PGP_SIGNATURE_CONTENT_TYPE = "application/pgp-signature";
export const DEB_CONTENT_TYPE = "application/vnd.debian.binary-package";

export interface AptReleaseSigner {
  clearSign(input: {
    text: string;
    privateKeyArmored: string;
    passphrase: string;
    signingDate: Date;
  }): Promise<string>;
  detachSign(input: {
    text: string;
    privateKeyArmored: string;
    passphrase: string;
    signingDate: Date;
  }): Promise<string>;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const packagesIndexPattern = /^([A-Za-z0-9][A-Za-z0-9._+~-]*)\/binary-([A-Za-z0-9][A-Za-z0-9._+~-]*)\/Packages$/;
const byHashIndexPattern = /^[A-Za-z0-9][A-Za-z0-9._+~-]*\/binary-[A-Za-z0-9][A-Za-z0-9._+~-]*\/by-hash\/[A-Za-z0-9]+\/[0-9a-f]+$/;

/** The `Release` checksum sections that also get a `by-hash` directory. */
const BY_HASH_ALGORITHMS = [
  { section: "SHA256", algorithm: "SHA-256" },
  { section: "SHA512", algorithm: "SHA-512" },
] as const;

export function distsPrefix(repositoryName: string, codename: string): string {
  return `repositories/${repositoryName}/dists/${codename}/`;
}

/**
 * Reads back the `Packages` indexes a repository already publishes.
 *
 * The publish pipeline only ever knows about the artifacts in the session it
 * is finalizing, so the state that survives between publishes has to come from
 * the indexes themselves. Each stanza already carries `Filename`, `Size` and
 * `SHA256`, which is everything needed to re-emit it without re-reading the
 * `.deb` it describes.
 */
export async function readAptPackageIndexes(input: {
  objectStore: RepositoryObjectStore;
  repositoryName: string;
  codename: string;
}): Promise<Map<string, AptIndexStanzas>> {
  const prefix = distsPrefix(input.repositoryName, input.codename);
  const objects = await listAllObjects(input.objectStore, prefix);
  const indexes = new Map<string, AptIndexStanzas>();

  for (const object of objects) {
    const match = packagesIndexPattern.exec(object.key.slice(prefix.length));
    const component = match?.[1];
    const architecture = match?.[2];
    if (!component || !architecture) {
      continue;
    }

    const stored = await input.objectStore.getObject(object.key);
    if (!stored) {
      continue;
    }
    indexes.set(indexKey(component, architecture), {
      component,
      architecture,
      stanzas: parseStanzas(textDecoder.decode(await objectBytes(stored))),
    });
  }

  return indexes;
}

export interface WrittenAptIndexes {
  objects: PublishedObject[];
  removedObjectKeys: string[];
}

/**
 * Commits a published state: copies the pool objects, writes every index, and
 * signs `Release` over them.
 *
 * Publishing and reconciling both end here so that the signed `Release` can
 * never disagree with the indexes on disk: whatever stanzas are handed in
 * become the complete published state, and index files that no longer have
 * stanzas are removed rather than left behind for `Release` to omit.
 *
 * Signing happens before the first write, so a signing failure leaves the
 * repository exactly as it was rather than half-updated.
 */
export async function writeAptRepositoryIndexes(input: {
  objectStore: RepositoryObjectStore;
  repositoryName: string;
  metadata: AptIndexMetadata;
  signer: AptReleaseSigner;
  signingKey: { privateKeyArmored: string; passphrase: string };
  publishedAt: string;
  poolCopies?: AptPoolCopy[];
}): Promise<WrittenAptIndexes> {
  const prefix = distsPrefix(input.repositoryName, input.metadata.config.codename);
  const { packageIndexes, release, releasePath } = input.metadata;
  const poolCopies = input.poolCopies ?? [];
  const inReleasePath = `${prefix}InRelease`;
  const releaseGpgPath = `${prefix}Release.gpg`;
  const signingInput = {
    text: release,
    privateKeyArmored: input.signingKey.privateKeyArmored,
    passphrase: input.signingKey.passphrase,
    signingDate: new Date(input.publishedAt),
  };
  const inRelease = await input.signer.clearSign(signingInput);
  const releaseGpg = await input.signer.detachSign(signingInput);

  const poolObjects: PublishedObject[] = poolCopies.map((copy) => ({
    key: copy.destinationKey,
    contentType: copy.contentType || DEB_CONTENT_TYPE,
  }));
  const indexObjects: PublishedObject[] = [
    ...packageIndexes.flatMap((packageIndex) => [
      { key: packageIndex.packagesPath, contentType: TEXT_CONTENT_TYPE },
      { key: packageIndex.packagesGzPath, contentType: GZIP_CONTENT_TYPE },
    ]),
    { key: releasePath, contentType: TEXT_CONTENT_TYPE },
    { key: inReleasePath, contentType: TEXT_CONTENT_TYPE },
    { key: releaseGpgPath, contentType: PGP_SIGNATURE_CONTENT_TYPE },
  ];
  const objects = [...poolObjects, ...indexObjects];
  const previous = await capturePreviousObjectMetadata(input.objectStore, objects.map((object) => object.key));
  const byHash = acquireByHashEnabled(input.metadata.config)
    ? await planByHashObjects({ objectStore: input.objectStore, prefix, releasePath, packageIndexes })
    : { objects: [], retainedKeys: new Set<string>() };
  const removedObjectKeys = await removeStaleIndexObjects({
    objectStore: input.objectStore,
    prefix,
    keptKeys: new Set([
      ...indexObjects.map((object) => object.key),
      ...byHash.objects.map((object) => object.key),
      ...byHash.retainedKeys,
    ]),
  });

  for (const copy of poolCopies) {
    await input.objectStore.copyObject(copy.sourceKey, copy.destinationKey, copy.contentType);
  }
  for (const packageIndex of packageIndexes) {
    await input.objectStore.putText(packageIndex.packagesPath, packageIndex.packages, TEXT_CONTENT_TYPE);
    await input.objectStore.putBytes(packageIndex.packagesGzPath, packageIndex.packagesGz, GZIP_CONTENT_TYPE);
  }
  for (const object of byHash.objects) {
    await input.objectStore.putBytes(object.key, object.bytes, object.contentType);
  }
  await input.objectStore.putText(releasePath, release, TEXT_CONTENT_TYPE);
  await input.objectStore.putText(inReleasePath, inRelease, TEXT_CONTENT_TYPE);
  await input.objectStore.putText(releaseGpgPath, releaseGpg, PGP_SIGNATURE_CONTENT_TYPE);

  return {
    objects: objects.map((object) => withPreviousMetadata(object, previous.get(object.key) ?? null)),
    removedObjectKeys,
  };
}

interface ByHashObject {
  key: string;
  bytes: Uint8Array;
  contentType: string;
}

/**
 * Works out the `by-hash` copies of each index and which older ones to keep.
 *
 * A client that reads `Release` and then fetches `Packages` can otherwise land
 * on a newer index than the one its `Release` describes, and reject the
 * mismatch. Fetching by content hash removes that race, but only if the index
 * a client just read about is still there — so the previous generation, named
 * by the `Release` being replaced, is kept alongside the current one. Anything
 * older is dropped, which bounds what this costs in storage.
 */
async function planByHashObjects(input: {
  objectStore: RepositoryObjectStore;
  prefix: string;
  releasePath: string;
  packageIndexes: AptPackageIndex[];
}): Promise<{ objects: ByHashObject[]; retainedKeys: Set<string> }> {
  const objects: ByHashObject[] = [];

  for (const packageIndex of input.packageIndexes) {
    for (const variant of [
      { relativePath: packageIndex.relativePath, bytes: textEncoder.encode(packageIndex.packages), contentType: TEXT_CONTENT_TYPE },
      { relativePath: packageIndex.relativeGzPath, bytes: packageIndex.packagesGz, contentType: GZIP_CONTENT_TYPE },
    ]) {
      for (const { section, algorithm } of BY_HASH_ALGORITHMS) {
        objects.push({
          key: byHashKey(input.prefix, variant.relativePath, section, await digestHex(algorithm, variant.bytes)),
          bytes: variant.bytes,
          contentType: variant.contentType,
        });
      }
    }
  }

  return { objects, retainedKeys: await previousByHashKeys(input) };
}

async function previousByHashKeys(input: {
  objectStore: RepositoryObjectStore;
  prefix: string;
  releasePath: string;
}): Promise<Set<string>> {
  const storedRelease = await input.objectStore.getObject(input.releasePath);
  if (!storedRelease) {
    return new Set();
  }

  const retained = new Set<string>();
  let section: string | undefined;
  for (const line of textDecoder.decode(await objectBytes(storedRelease)).split("\n")) {
    const sectionMatch = /^([A-Za-z0-9]+):$/.exec(line);
    if (sectionMatch) {
      section = BY_HASH_ALGORITHMS.some((candidate) => candidate.section === sectionMatch[1])
        ? sectionMatch[1]
        : undefined;
      continue;
    }
    const entry = /^ ([0-9a-f]+) +\d+ +(\S+)$/.exec(line);
    if (section && entry?.[1] && entry[2]) {
      retained.add(byHashKey(input.prefix, entry[2], section, entry[1]));
    }
  }

  return retained;
}

function byHashKey(prefix: string, relativePath: string, section: string, digest: string): string {
  const directory = relativePath.slice(0, relativePath.lastIndexOf("/"));
  return `${prefix}${directory}/by-hash/${section}/${digest}`;
}

export async function capturePreviousObjectMetadata(
  objectStore: RepositoryObjectStore,
  keys: string[],
): Promise<Map<string, RepositoryObjectMetadata | null>> {
  return new Map(
    await Promise.all(keys.map(async (key) => [key, await objectStore.headObject(key)] as const)),
  );
}

export function withPreviousMetadata(
  object: PublishedObject,
  previous: RepositoryObjectMetadata | null,
): PublishedObject {
  if (!previous) {
    return object;
  }
  return {
    ...object,
    previous: {
      ...(previous.contentType !== undefined ? { contentType: previous.contentType } : {}),
      ...(previous.contentLength !== undefined ? { size: previous.contentLength } : {}),
      ...(previous.etag !== undefined ? { etag: previous.etag } : {}),
    },
  };
}

/**
 * Drops index files that this write no longer covers.
 *
 * `Release` only lists the indexes written here, and apt refuses a repository
 * whose `Release` omits an index its sources.list asks for. Leaving an
 * orphaned `Packages` behind would therefore be worse than deleting it.
 */
async function removeStaleIndexObjects(input: {
  objectStore: RepositoryObjectStore;
  prefix: string;
  keptKeys: Set<string>;
}): Promise<string[]> {
  const existing = await listAllObjects(input.objectStore, input.prefix);
  const removed: string[] = [];

  for (const object of existing) {
    const relativePath = object.key.slice(input.prefix.length);
    const isIndexObject = packagesIndexPattern.test(relativePath.replace(/\.gz$/, ""))
      || byHashIndexPattern.test(relativePath);
    if (!isIndexObject || input.keptKeys.has(object.key)) {
      continue;
    }
    if (await input.objectStore.deleteObject(object.key)) {
      removed.push(object.key);
    }
  }

  return removed;
}
