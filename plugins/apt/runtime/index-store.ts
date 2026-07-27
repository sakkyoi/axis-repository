import type {
  PublishedObject,
  RepositoryObjectListItem,
  RepositoryObjectMetadata,
  RepositoryObjectStore,
} from "@axis-repository/core";
import { listAllObjects, objectBytes } from "@axis-repository/runtime-cloudflare/plugin-runtime";
import { parseStanzas, type DebianStanza } from "../shared/stanza";
import { streamFromBytes } from "../shared/tar";
import { parseContentsIndex, type AptContentsIndexes } from "./contents";
import type { AptIndexFile } from "./index-files";
import type { AptIndexMetadata } from "./metadata";
import { indexKey, type AptPoolCopy, type AptSuiteIndexes } from "./packages";
import {
  BY_HASH_SECTIONS,
  RELEASE_CHECKSUM_SECTIONS,
  acquireByHashEnabled,
  checksumForSection,
  type ReleaseChecksumSection,
} from "./release";

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

const textDecoder = new TextDecoder();
const packagesIndexPattern = /^([A-Za-z0-9][A-Za-z0-9._+~-]*)\/(debian-installer\/)?binary-([A-Za-z0-9][A-Za-z0-9._+~-]*)\/Packages$/;
const sourcesIndexPattern = /^([A-Za-z0-9][A-Za-z0-9._+~-]*)\/source\/Sources$/;
const contentsIndexPattern = /^([A-Za-z0-9][A-Za-z0-9._+~-]*)\/Contents-(udeb-)?([A-Za-z0-9][A-Za-z0-9._+~-]*)\.gz$/;

export function distsPrefix(repositoryName: string, suite: string): string {
  return `repositories/${repositoryName}/dists/${suite}/`;
}

/** What one suite currently publishes: its package indexes and its file lists. */
export interface AptSuiteState {
  packages: AptSuiteIndexes;
  contents: AptContentsIndexes;
  sources: Map<string, DebianStanza[]>;
}

/** Reads back the published state of every suite the repository declares. */
export async function readAptSuiteStates(input: {
  objectStore: RepositoryObjectStore;
  repositoryName: string;
  suites: string[];
}): Promise<Map<string, AptSuiteState>> {
  return new Map(
    await Promise.all(input.suites.map(async (suite) => [
      suite,
      await readAptSuiteState({ objectStore: input.objectStore, repositoryName: input.repositoryName, suite }),
    ] as const)),
  );
}

export function suitePackageIndexes(states: Map<string, AptSuiteState>): Map<string, AptSuiteIndexes> {
  return new Map([...states].map(([suite, state]) => [suite, state.packages]));
}

export function suiteContentsIndexes(states: Map<string, AptSuiteState>): Map<string, AptContentsIndexes> {
  return new Map([...states].map(([suite, state]) => [suite, state.contents]));
}

export function suiteSourceIndexes(states: Map<string, AptSuiteState>): Map<string, Map<string, DebianStanza[]>> {
  return new Map([...states].map(([suite, state]) => [suite, state.sources]));
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
export async function readAptSuiteState(input: {
  objectStore: RepositoryObjectStore;
  repositoryName: string;
  suite: string;
}): Promise<AptSuiteState> {
  const prefix = distsPrefix(input.repositoryName, input.suite);
  const objects = await listAllObjects(input.objectStore, prefix);
  const packages: AptSuiteIndexes = new Map();
  const contents: AptContentsIndexes = new Map();
  const sources = new Map<string, DebianStanza[]>();

  for (const object of objects) {
    const relativePath = object.key.slice(prefix.length);
    const packagesMatch = packagesIndexPattern.exec(relativePath);
    const contentsMatch = contentsIndexPattern.exec(relativePath);
    const sourcesMatch = sourcesIndexPattern.exec(relativePath);
    if (!packagesMatch && !contentsMatch && !sourcesMatch) {
      continue;
    }

    const stored = await input.objectStore.getObject(object.key);
    if (!stored) {
      continue;
    }
    const bytes = await objectBytes(stored);

    if (sourcesMatch?.[1]) {
      sources.set(sourcesMatch[1], parseStanzas(textDecoder.decode(bytes)));
      continue;
    }
    const component = packagesMatch?.[1] ?? contentsMatch?.[1];
    const architecture = packagesMatch?.[3] ?? contentsMatch?.[3];
    const installer = (packagesMatch?.[2] ?? contentsMatch?.[2]) !== undefined;
    if (!component || !architecture) {
      continue;
    }
    if (packagesMatch) {
      packages.set(indexKey(component, architecture, installer), {
        component,
        architecture,
        ...(installer ? { installer } : {}),
        stanzas: parseStanzas(textDecoder.decode(bytes)),
      });
    } else {
      contents.set(
        indexKey(component, architecture, installer),
        parseContentsIndex(textDecoder.decode(await gunzip(bytes))),
      );
    }
  }

  return { packages, contents, sources };
}

/** `Contents` is published gzipped only, so reading it back has to undo that. */
async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = streamFromBytes(bytes).pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
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
 * never disagree with the indexes on disk: whatever is handed in becomes the
 * complete published state, and anything else under `dists/<codename>/` is
 * removed. That directory is entirely generated, and apt refuses a repository
 * whose `Release` omits an index its sources.list asks for, so an orphaned
 * index file is worse than a deleted one.
 *
 * Signing happens before the first write, so a signing failure leaves the
 * repository exactly as it was rather than half-updated.
 */
export async function writeAptRepositoryIndexes(input: {
  objectStore: RepositoryObjectStore;
  repositoryName: string;
  suites: AptIndexMetadata[];
  signer: AptReleaseSigner;
  signingKey: { privateKeyArmored: string; passphrase: string };
  publishedAt: string;
  poolCopies?: AptPoolCopy[];
}): Promise<WrittenAptIndexes> {
  const poolCopies = input.poolCopies ?? [];
  const prepared = await Promise.all(input.suites.map((metadata) => prepareSuiteWrite({
    objectStore: input.objectStore,
    repositoryName: input.repositoryName,
    metadata,
    signer: input.signer,
    signingKey: input.signingKey,
    publishedAt: input.publishedAt,
  })));

  const poolObjects: PublishedObject[] = poolCopies.map((copy) => ({
    key: copy.destinationKey,
    contentType: copy.contentType || DEB_CONTENT_TYPE,
  }));
  const objects = [...poolObjects, ...prepared.flatMap((suite) => suite.indexObjects)];
  const previous = await capturePreviousObjectMetadata(input.objectStore, objects.map((object) => object.key));
  const removedObjectKeys: string[] = [];
  // The listing that finds stale objects also says which of the objects about
  // to be written are already there, so nothing is skipped on the strength of
  // a Release entry alone.
  const existingKeys = new Map<PreparedSuiteWrite, Set<string>>();
  for (const suite of prepared) {
    const existing = await listAllObjects(input.objectStore, suite.prefix);
    existingKeys.set(suite, new Set(existing.map((object) => object.key)));
    removedObjectKeys.push(...await removeStaleIndexObjects({
      objectStore: input.objectStore,
      existing,
      keptKeys: new Set([
        ...suite.indexObjects.map((object) => object.key),
        ...suite.byHash.objects.map((object) => object.key),
        ...suite.byHash.retainedKeys,
      ]),
    }));
  }

  for (const copy of poolCopies) {
    await input.objectStore.copyObject(copy.sourceKey, copy.destinationKey, copy.contentType);
  }
  for (const suite of prepared) {
    await suite.commit(existingKeys.get(suite) ?? new Set());
  }

  return {
    objects: objects.map((object) => withPreviousMetadata(object, previous.get(object.key) ?? null)),
    removedObjectKeys,
  };
}

interface PreparedSuiteWrite {
  prefix: string;
  indexObjects: PublishedObject[];
  byHash: { objects: ByHashObject[]; retainedKeys: Set<string> };
  /** @param existingKeys every key already under this suite, as just listed. */
  commit(existingKeys: Set<string>): Promise<void>;
}

/**
 * Signs one suite and returns everything needed to write it, without writing.
 *
 * Every suite is signed before any of them is written, so a signing failure
 * part way through leaves the repository exactly as it was rather than with
 * some suites updated and others not.
 */
async function prepareSuiteWrite(input: {
  objectStore: RepositoryObjectStore;
  repositoryName: string;
  metadata: AptIndexMetadata;
  signer: AptReleaseSigner;
  signingKey: { privateKeyArmored: string; passphrase: string };
  publishedAt: string;
}): Promise<PreparedSuiteWrite> {
  const prefix = distsPrefix(input.repositoryName, input.metadata.suite);
  const { indexFiles, release, releasePath } = input.metadata;
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
  const indexObjects: PublishedObject[] = [
    ...indexFiles.map((file) => ({ key: `${prefix}${file.relativePath}`, contentType: file.contentType })),
    { key: releasePath, contentType: TEXT_CONTENT_TYPE },
    { key: inReleasePath, contentType: TEXT_CONTENT_TYPE },
    { key: releaseGpgPath, contentType: PGP_SIGNATURE_CONTENT_TYPE },
  ];

  const published = await readPublishedRelease(input.objectStore, releasePath);
  const digested = await digestIndexFiles(indexFiles);
  const byHashEnabled = acquireByHashEnabled(input.metadata.config);
  const byHash = {
    objects: byHashEnabled ? byHashObjects(prefix, digested) : [],
    retainedKeys: previousByHashKeys(prefix, published),
  };

  return {
    prefix,
    indexObjects,
    byHash,
    commit: async (existingKeys) => {
      // Most publishes touch one architecture of one component, and rewriting
      // every other index would cost a write apiece to store bytes already
      // there. An index is written when it differs from what Release describes,
      // or when the object it describes is not actually there.
      const rewritten = new Set(digested
        .filter((entry) => !matchesPublished(entry, published)
          || !existingKeys.has(`${prefix}${entry.file.relativePath}`))
        .map((entry) => entry.file.relativePath));

      for (const file of indexFiles) {
        if (!rewritten.has(file.relativePath)) {
          continue;
        }
        const key = `${prefix}${file.relativePath}`;
        if (file.text === undefined) {
          await input.objectStore.putBytes(key, file.bytes, file.contentType);
        } else {
          await input.objectStore.putText(key, file.text, file.contentType);
        }
      }
      for (const object of byHash.objects) {
        // A by-hash copy is named by its own digest, so an unchanged index
        // already has one under exactly this key.
        if (!rewritten.has(object.relativePath) && existingKeys.has(object.key)) {
          continue;
        }
        await input.objectStore.putBytes(object.key, object.bytes, object.contentType);
      }
      // Release carries the publish date and a fresh signature, so all three
      // are written every time even when no index moved.
      await input.objectStore.putText(releasePath, release, TEXT_CONTENT_TYPE);
      await input.objectStore.putText(inReleasePath, inRelease, TEXT_CONTENT_TYPE);
      await input.objectStore.putText(releaseGpgPath, releaseGpg, PGP_SIGNATURE_CONTENT_TYPE);
    },
  };
}

interface DigestedIndexFile {
  file: AptIndexFile;
  digests: Map<ReleaseChecksumSection, string>;
}

/** Digests each index once, for both the by-hash keys and the change check. */
async function digestIndexFiles(indexFiles: AptIndexFile[]): Promise<DigestedIndexFile[]> {
  return Promise.all(indexFiles.map(async (file) => ({
    file,
    digests: new Map(await Promise.all(BY_HASH_SECTIONS.map(async (section) => [
      section,
      await checksumForSection(section, file.bytes),
    ] as const))),
  })));
}

function matchesPublished(entry: DigestedIndexFile, published: PublishedReleaseState | null): boolean {
  const path = entry.file.relativePath;
  if (published?.sizes.get(path) !== entry.file.bytes.byteLength) {
    return false;
  }
  const digest = entry.digests.get("SHA256");
  return digest !== undefined && published.digests.get(path)?.get("SHA256") === digest;
}

interface ByHashObject {
  key: string;
  relativePath: string;
  bytes: Uint8Array;
  contentType: string;
}

/**
 * Works out the `by-hash` copies of each index.
 *
 * A client that reads `Release` and then fetches an index can otherwise land
 * on a newer one than its `Release` describes, and reject the mismatch.
 * Fetching by content hash removes that race, but only if the index a client
 * just read about is still there — so the previous generation, named by the
 * `Release` being replaced, is kept alongside the current one. Anything older
 * is dropped, which bounds what this costs in storage.
 */
function byHashObjects(prefix: string, digested: DigestedIndexFile[]): ByHashObject[] {
  return digested.flatMap((entry) => BY_HASH_SECTIONS.flatMap((section) => {
    const digest = entry.digests.get(section);
    return digest === undefined ? [] : [{
      key: byHashKey(prefix, entry.file.relativePath, section, digest),
      relativePath: entry.file.relativePath,
      bytes: entry.file.bytes,
      contentType: entry.file.contentType,
    }];
  }));
}

/**
 * What the `Release` already on disk says about the indexes it describes.
 *
 * It names every index with its size and digests, which is enough to tell
 * whether a freshly built index differs from the published one without reading
 * any of them back.
 */
interface PublishedReleaseState {
  digests: Map<string, Map<ReleaseChecksumSection, string>>;
  sizes: Map<string, number>;
  /** Whether that write also published `by-hash` copies of those indexes. */
  byHashEnabled: boolean;
}

async function readPublishedRelease(
  objectStore: RepositoryObjectStore,
  releasePath: string,
): Promise<PublishedReleaseState | null> {
  const storedRelease = await objectStore.getObject(releasePath);
  if (!storedRelease) {
    return null;
  }

  const digests = new Map<string, Map<ReleaseChecksumSection, string>>();
  const sizes = new Map<string, number>();
  let byHashEnabled = false;
  let section: ReleaseChecksumSection | undefined;

  for (const line of textDecoder.decode(await objectBytes(storedRelease)).split("\n")) {
    const sectionMatch = /^([A-Za-z0-9]+):$/.exec(line);
    if (sectionMatch) {
      section = RELEASE_CHECKSUM_SECTIONS.find((candidate) => candidate === sectionMatch[1]);
      continue;
    }
    if (line === "Acquire-By-Hash: yes") {
      byHashEnabled = true;
      continue;
    }
    const entry = /^ ([0-9a-f]+) +(\d+) +(\S+)$/.exec(line);
    const [, digest, size, path] = entry ?? [];
    if (!section || !digest || !size || !path) {
      continue;
    }
    const forPath = digests.get(path) ?? new Map<ReleaseChecksumSection, string>();
    forPath.set(section, digest);
    digests.set(path, forPath);
    sizes.set(path, Number(size));
  }

  return { digests, sizes, byHashEnabled };
}

function previousByHashKeys(prefix: string, previous: PublishedReleaseState | null): Set<string> {
  const retained = new Set<string>();

  for (const [path, sections] of previous?.digests ?? []) {
    for (const section of BY_HASH_SECTIONS) {
      const digest = sections.get(section);
      if (digest) {
        retained.add(byHashKey(prefix, path, section, digest));
      }
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
 * Drops everything under the suite that this write did not produce.
 *
 * `dists/<codename>/` is generated in full on every write, so anything left
 * over is an index from a previous shape of the repository. `Release` lists
 * only what was written here, and apt refuses a repository whose `Release`
 * omits an index its sources.list asks for — an orphaned index file is worse
 * than a deleted one.
 */
async function removeStaleIndexObjects(input: {
  objectStore: RepositoryObjectStore;
  existing: RepositoryObjectListItem[];
  keptKeys: Set<string>;
}): Promise<string[]> {
  const removed: string[] = [];

  for (const object of input.existing) {
    if (input.keptKeys.has(object.key)) {
      continue;
    }
    if (await input.objectStore.deleteObject(object.key)) {
      removed.push(object.key);
    }
  }

  return removed;
}
