import {
  ValidationError,
  type Repository,
  type RepositoryArtifactRecord,
  type RepositoryObjectStore,
} from "@axis-repository/core";
import {
  listAllObjects,
  objectBytes,
  objectStream,
  type RepositorySigningKeyCapability,
} from "@axis-repository/runtime-cloudflare/plugin-runtime";
import { stanzaField, type DebianStanza } from "../shared/stanza";
import { readDebControlMetadata } from "./deb-control";
import { debArchiveSourceForObject } from "./deb-source";
import { digestStreamHex } from "./digest";
import {
  readAptSuiteStates,
  suiteContentsIndexes,
  suitePackageIndexes,
  suiteSourceIndexes,
  writeAptRepositoryIndexes,
  type AptReleaseSigner,
} from "./index-store";
import { buildAptIndexMetadata, parseAptRepositoryConfig } from "./metadata";
import {
  buildPackageStanza,
  indexKey,
  packageStanzaMetadata,
  resolveAptRepositoryConfig,
  type AptIndexStanzas,
  type AptSuiteIndexes,
} from "./packages";
import { aptArtifactMetadataFromDebControl } from "./publisher";
import { buildSourceStanza, parseDsc, sourceStanzaFilenames } from "./sources";

interface ReconciledPoolEntry {
  objectKey: string;
  relativeFilename: string;
  component: string;
  architecture: string;
  installer: boolean;
  stanza: DebianStanza;
  suites: string[];
}

interface ReconciledSourceEntry {
  objectKey: string;
  component: string;
  stanza: DebianStanza;
  suites: string[];
}

/**
 * Makes the published indexes agree with what is actually in the pool.
 *
 * This is the repair path. A publish is additive and a delete only removes
 * pool objects, so the two can drift: a deleted `.deb` stays advertised in
 * `Packages` until something removes its stanza, and an object restored or
 * uploaded out of band is invisible until something adds one. Reconciling
 * against the pool covers both, and re-signs `Release` over the result.
 *
 * Stanzas are reused wherever the pool object is already indexed, so the
 * common case does not re-download every package to recompute a digest it
 * already published. A pool object no suite indexes cannot say where it
 * belongs, so it is added to the default suite — the same place a publish
 * that names no suite goes.
 */
export async function reconcileAptRepository(input: {
  repository: Repository;
  objectStore: RepositoryObjectStore;
  signingKeys: RepositorySigningKeyCapability;
  signer: AptReleaseSigner;
  now: Date;
}): Promise<RepositoryArtifactRecord[]> {
  const parsedConfig = parseAptRepositoryConfig(input.repository);
  const suiteNames = parsedConfig.suites ?? [parsedConfig.codename];
  const repositoryPrefix = `repositories/${input.repository.name}/`;
  const published = await readAptSuiteStates({
    objectStore: input.objectStore,
    repositoryName: input.repository.name,
    suites: suiteNames,
  });
  const existingIndexes = suitePackageIndexes(published);
  const existingContents = suiteContentsIndexes(published);
  const indexedStanzas = stanzasByFilename(existingIndexes);
  const allPoolObjects = await listAllObjects(input.objectStore, `${repositoryPrefix}pool/`);
  const poolObjects = allPoolObjects
    .filter((object) => object.key.endsWith(".deb") || object.key.endsWith(".udeb"));
  const sourceEntries = await reconcileSourceEntries({
    objectStore: input.objectStore,
    repositoryPrefix,
    poolObjects: allPoolObjects.filter((object) => object.key.endsWith(".dsc")),
    existingSources: suiteSourceIndexes(published),
    defaultSuite: parsedConfig.codename,
  });

  const entries: ReconciledPoolEntry[] = [];
  for (const object of poolObjects) {
    const relativeFilename = object.key.slice(repositoryPrefix.length);
    const indexed = indexedStanzas.get(relativeFilename);
    const stanza = indexed?.stanza
      ?? await stanzaFromPoolObject({
        objectStore: input.objectStore,
        objectKey: object.key,
        relativeFilename,
        config: parsedConfig,
      });
    if (!stanza) {
      continue;
    }
    entries.push({
      objectKey: object.key,
      relativeFilename,
      component: relativeFilename.split("/")[1] ?? "main",
      architecture: stanzaField(stanza, "Architecture") ?? "all",
      installer: object.key.endsWith(".udeb"),
      stanza,
      suites: indexed?.suites ?? [parsedConfig.codename],
    });
  }

  const nothingPublished = [...published.values()]
    .every((state) => state.packages.size === 0 && state.sources.size === 0);
  if (entries.length === 0 && sourceEntries.length === 0 && nothingPublished) {
    // Nothing has ever been published, so there is nothing to reconcile. Not
    // even a signing key is needed: writing an empty signed Release here would
    // make a rebuild fail on a repository that simply has no packages yet.
    return [];
  }

  const config = resolveAptRepositoryConfig({
    config: parsedConfig,
    existing: existingIndexes.values(),
    publishedArchitectures: entries.map((entry) => entry.architecture),
  });
  const publishedAt = input.now.toISOString();
  const suites = await Promise.all(config.suites.map((suite) => buildAptIndexMetadata({
    repositoryName: input.repository.name,
    config,
    suite,
    stanzasByIndex: suiteStanzas(entries.filter((entry) => entry.suites.includes(suite)), config.architectures),
    existingContents: existingContents.get(suite),
    incomingSources: sourcesByComponent(sourceEntries.filter((entry) => entry.suites.includes(suite))),
    publishDate: publishedAt,
  })));

  await writeAptRepositoryIndexes({
    objectStore: input.objectStore,
    repositoryName: input.repository.name,
    suites,
    signer: input.signer,
    signingKey: await input.signingKeys.getActivePrivateKey(config.signingKeyId, input.repository.name),
    publishedAt,
  });

  return entries.map((entry) => artifactRecord(input.repository, entry, publishedAt));
}

function suiteStanzas(entries: ReconciledPoolEntry[], architectures: string[]): AptSuiteIndexes {
  const stanzasByIndex: AptSuiteIndexes = new Map();

  for (const entry of entries) {
    const targets = entry.architecture === "all" ? architectures : [entry.architecture];
    for (const architecture of targets) {
      const key = indexKey(entry.component, architecture, entry.installer);
      const index: AptIndexStanzas = stanzasByIndex.get(key)
        ?? {
          component: entry.component,
          architecture,
          ...(entry.installer ? { installer: true } : {}),
          stanzas: [],
        };
      index.stanzas.push(entry.stanza);
      stanzasByIndex.set(key, index);
    }
  }

  return stanzasByIndex;
}

function sourcesByComponent(entries: ReconciledSourceEntry[]): Map<string, DebianStanza[]> {
  const byComponent = new Map<string, DebianStanza[]>();
  for (const entry of entries) {
    byComponent.set(entry.component, [...(byComponent.get(entry.component) ?? []), entry.stanza]);
  }
  return byComponent;
}

/**
 * Rebuilds the source stanzas from the `.dsc` files still in the pool.
 *
 * A `.dsc` is small and self-describing, so unlike a `.deb` it is cheap to
 * re-read; the stanza is derived fresh rather than salvaged from the index.
 * Which suites a source package belongs to still comes from the indexes, since
 * the pool cannot say.
 */
async function reconcileSourceEntries(input: {
  objectStore: RepositoryObjectStore;
  repositoryPrefix: string;
  poolObjects: Array<{ key: string }>;
  existingSources: Map<string, Map<string, DebianStanza[]>>;
  defaultSuite: string;
}): Promise<ReconciledSourceEntry[]> {
  const suitesByDsc = new Map<string, string[]>();
  for (const [suite, byComponent] of input.existingSources) {
    for (const stanza of [...byComponent.values()].flat()) {
      for (const filename of sourceStanzaFilenames(stanza)) {
        if (!filename.endsWith(".dsc")) {
          continue;
        }
        const suites = suitesByDsc.get(filename) ?? [];
        if (!suites.includes(suite)) {
          suites.push(suite);
        }
        suitesByDsc.set(filename, suites);
      }
    }
  }

  const entries: ReconciledSourceEntry[] = [];
  for (const object of input.poolObjects) {
    const stored = await input.objectStore.getObject(object.key);
    if (!stored) {
      continue;
    }
    const relativeFilename = object.key.slice(input.repositoryPrefix.length);
    const segments = relativeFilename.split("/");
    const component = segments[1] ?? "main";
    const bytes = await objectBytes(stored);
    const dsc = parseDsc(bytes);
    entries.push({
      objectKey: object.key,
      component,
      stanza: await buildSourceStanza({
        dsc,
        dscFile: { name: segments[segments.length - 1] ?? relativeFilename, size: bytes.byteLength, bytes },
        component,
        directory: segments.slice(0, -1).join("/"),
      }),
      suites: suitesByDsc.get(relativeFilename) ?? [input.defaultSuite],
    });
  }

  return entries;
}

/** Records which suites already index each pool object, and under what stanza. */
function stanzasByFilename(
  suiteIndexes: Map<string, AptSuiteIndexes>,
): Map<string, { stanza: DebianStanza; suites: string[] }> {
  const byFilename = new Map<string, { stanza: DebianStanza; suites: string[] }>();

  for (const [suite, indexes] of suiteIndexes) {
    for (const index of indexes.values()) {
      for (const stanza of index.stanzas) {
        const filename = stanzaField(stanza, "Filename");
        if (filename === undefined) {
          continue;
        }
        const existing = byFilename.get(filename);
        if (!existing) {
          byFilename.set(filename, { stanza, suites: [suite] });
        } else if (!existing.suites.includes(suite)) {
          existing.suites.push(suite);
        }
      }
    }
  }

  return byFilename;
}

async function stanzaFromPoolObject(input: {
  objectStore: RepositoryObjectStore;
  objectKey: string;
  relativeFilename: string;
  config: ReturnType<typeof parseAptRepositoryConfig>;
}): Promise<DebianStanza | undefined> {
  const head = await input.objectStore.headObject(input.objectKey);
  if (!head || head.contentLength === undefined) {
    return undefined;
  }

  // A pool object is read the same way an upload is: its control fields come
  // from ranged reads, and its digest from streaming it past a hash. Neither
  // needs the package in memory, and reconciling has to cope with whatever
  // size was published.
  const source = debArchiveSourceForObject({
    objectStore: input.objectStore,
    key: input.objectKey,
    size: head.contentLength,
  });
  const control = await readDebControlMetadata(source);
  const stored = await input.objectStore.getObject(input.objectKey);
  if (!stored) {
    return undefined;
  }

  const metadata = aptArtifactMetadataFromDebControl({
    config: input.config,
    artifact: {
      filename: input.relativeFilename.split("/").pop() ?? input.relativeFilename,
      size: head.contentLength,
      sha256: "",
      contentType: head.contentType ?? "application/vnd.debian.binary-package",
      metadata: { component: input.relativeFilename.split("/")[1] ?? "main" },
    },
    control,
  });

  return buildPackageStanza({
    metadata,
    packageName: requiredControlField(control.package, "package"),
    version: requiredControlField(control.version, "version"),
    architecture: requiredControlField(control.architecture, "architecture"),
    maintainer: requiredControlField(control.maintainer, "maintainer"),
    description: requiredControlField(control.description, "description"),
    filename: input.relativeFilename,
    size: head.contentLength,
    sha256: await digestStreamHex("SHA-256", objectStream(stored)),
  });
}

function artifactRecord(
  repository: Repository,
  entry: ReconciledPoolEntry,
  timestamp: string,
): RepositoryArtifactRecord {
  const metadata: Record<string, unknown> = {
    ...packageStanzaMetadata(entry.stanza),
    component: entry.component,
    suites: [...entry.suites],
  };
  const packageName = stanzaField(entry.stanza, "Package") ?? "";
  const version = stanzaField(entry.stanza, "Version") ?? "";
  const architecture = stanzaField(entry.stanza, "Architecture") ?? "";
  const identityParts = ["apt", entry.component, packageName, version, architecture];

  return {
    id: `artifact_${repository.name}_${identityParts.join("_")}`,
    repositoryName: repository.name,
    ecosystem: repository.ecosystem,
    identity: identityParts.join(":"),
    name: packageName,
    version,
    summary: `${packageName} ${version} ${architecture}`,
    primaryObjectKey: entry.objectKey,
    objectKeys: [entry.objectKey],
    metadata,
    publishedAt: timestamp,
    updatedAt: timestamp,
  };
}

function requiredControlField(value: string | undefined, field: string): string {
  if (!value) {
    throw new ValidationError(`APT artifact control field is required: ${field}`);
  }
  return value;
}
