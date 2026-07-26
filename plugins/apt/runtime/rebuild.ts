import {
  ValidationError,
  type Repository,
  type RepositoryArtifactRecord,
  type RepositoryObjectStore,
} from "@axis-repository/core";
import {
  listAllObjects,
  objectBytes,
  type RepositorySigningKeyCapability,
} from "@axis-repository/runtime-cloudflare/plugin-runtime";
import { stanzaField, type DebianStanza } from "../shared/stanza";
import { readDebControlMetadata } from "./deb-control";
import { digestHex } from "./digest";
import { readAptPackageIndexes, writeAptRepositoryIndexes, type AptReleaseSigner } from "./index-store";
import { buildAptIndexMetadata, parseAptRepositoryConfig } from "./metadata";
import {
  buildPackageStanza,
  indexKey,
  packageStanzaMetadata,
  resolveAptRepositoryConfig,
  type AptIndexStanzas,
} from "./packages";
import { aptArtifactMetadataFromDebControl } from "./publisher";

interface ReconciledPoolEntry {
  objectKey: string;
  relativeFilename: string;
  component: string;
  architecture: string;
  stanza: DebianStanza;
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
 * already published.
 */
export async function reconcileAptRepository(input: {
  repository: Repository;
  objectStore: RepositoryObjectStore;
  signingKeys: RepositorySigningKeyCapability;
  signer: AptReleaseSigner;
  now: Date;
}): Promise<RepositoryArtifactRecord[]> {
  const parsedConfig = parseAptRepositoryConfig(input.repository);
  const repositoryPrefix = `repositories/${input.repository.name}/`;
  const existingIndexes = await readAptPackageIndexes({
    objectStore: input.objectStore,
    repositoryName: input.repository.name,
    codename: parsedConfig.codename,
  });
  const indexedStanzas = stanzasByFilename(existingIndexes);
  const poolObjects = (await listAllObjects(input.objectStore, `${repositoryPrefix}pool/`))
    .filter((object) => object.key.endsWith(".deb") || object.key.endsWith(".udeb"));

  const entries: ReconciledPoolEntry[] = [];
  for (const object of poolObjects) {
    const relativeFilename = object.key.slice(repositoryPrefix.length);
    const stanza = indexedStanzas.get(relativeFilename)
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
      stanza,
    });
  }

  if (entries.length === 0 && existingIndexes.size === 0) {
    // Nothing has ever been published, so there is nothing to reconcile. Not
    // even a signing key is needed: writing an empty signed Release here would
    // make a rebuild fail on a repository that simply has no packages yet.
    return [];
  }

  const config = resolveAptRepositoryConfig({
    config: parsedConfig,
    existing: existingIndexes,
    publishedArchitectures: entries.map((entry) => entry.architecture),
  });
  const stanzasByIndex = new Map<string, AptIndexStanzas>();
  for (const entry of entries) {
    const architectures = entry.architecture === "all" ? config.architectures : [entry.architecture];
    for (const architecture of architectures) {
      const key = indexKey(entry.component, architecture);
      const index = stanzasByIndex.get(key) ?? { component: entry.component, architecture, stanzas: [] };
      index.stanzas.push(entry.stanza);
      stanzasByIndex.set(key, index);
    }
  }

  const publishedAt = input.now.toISOString();
  await writeAptRepositoryIndexes({
    objectStore: input.objectStore,
    repositoryName: input.repository.name,
    metadata: await buildAptIndexMetadata({
      repositoryName: input.repository.name,
      config,
      stanzasByIndex,
      publishDate: publishedAt,
    }),
    signer: input.signer,
    signingKey: await input.signingKeys.getActivePrivateKey(config.signingKeyId, input.repository.name),
    publishedAt,
  });

  return entries.map((entry) => artifactRecord(input.repository, entry, publishedAt));
}

function stanzasByFilename(indexes: Map<string, AptIndexStanzas>): Map<string, DebianStanza> {
  const byFilename = new Map<string, DebianStanza>();

  for (const index of indexes.values()) {
    for (const stanza of index.stanzas) {
      const filename = stanzaField(stanza, "Filename");
      if (filename !== undefined && !byFilename.has(filename)) {
        byFilename.set(filename, stanza);
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
  const stored = await input.objectStore.getObject(input.objectKey);
  if (!stored) {
    return undefined;
  }

  const bytes = await objectBytes(stored);
  const control = await readDebControlMetadata(bytes);
  const metadata = aptArtifactMetadataFromDebControl({
    config: input.config,
    artifact: {
      filename: input.relativeFilename.split("/").pop() ?? input.relativeFilename,
      size: bytes.byteLength,
      sha256: "",
      contentType: stored.contentType ?? "application/vnd.debian.binary-package",
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
    size: bytes.byteLength,
    sha256: await digestHex("SHA-256", bytes),
  });
}

function artifactRecord(
  repository: Repository,
  entry: ReconciledPoolEntry,
  timestamp: string,
): RepositoryArtifactRecord {
  const metadata = { ...packageStanzaMetadata(entry.stanza), component: entry.component };
  const packageName = String(metadata.package ?? "");
  const version = String(metadata.version ?? "");
  const architecture = String(metadata.architecture ?? "");
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
