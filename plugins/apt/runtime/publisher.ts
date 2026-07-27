import {
  ValidationError,
  type ArtifactPublisher,
  type PublishedArtifactInput,
  type PublishArtifactsInput,
  type PublishArtifactRequest,
  type PublishResult,
  type RepositoryObjectStore,
} from "@axis-repository/core";
import { listAllObjects, objectBytes, type RepositorySigningKeyCapability } from "@axis-repository/runtime-cloudflare/plugin-runtime";
import { aptArtifactKind, debControlMetadataFields } from "./packages";
import { readDebControlMetadata, type DebControlMetadata } from "./deb-control";
import { readDebFilePaths } from "../shared/deb-files";
import { openUploadedDebArchive } from "./deb-source";
import {
  readAptSuiteStates,
  suiteContentsIndexes,
  suitePackageIndexes,
  suiteSourceIndexes,
  writeAptRepositoryIndexes,
  type AptReleaseSigner,
} from "./index-store";
import { buildAptRepositoryMetadata, parseAptRepositoryConfig } from "./metadata";
import type { AptRepositoryConfig } from "./config";

const textDecoder = new TextDecoder();

export class AptPublisher implements ArtifactPublisher {
  constructor(
    private readonly options: {
      /** Resolves the store for the repository being published to. */
      objectStoreFor: (repositoryName: string) => RepositoryObjectStore;
      signingKeys: RepositorySigningKeyCapability;
      signer: AptReleaseSigner;
    },
  ) {}

  async publish(input: PublishArtifactsInput): Promise<PublishResult> {
    const objectStore = this.options.objectStoreFor(input.repository.name);
    const config = parseAptRepositoryConfig(input.repository);
    if (!input.session.requestedBy.signingKeyIds.includes(config.signingKeyId)) {
      throw new ValidationError("Publish token is not scoped to the repository signing key");
    }
    const enrichedInput = await this.enrichArtifactsWithDebControlMetadata(input, config, objectStore);
    const published = await readAptSuiteStates({
      objectStore,
      repositoryName: input.repository.name,
      suites: config.suites ?? [config.codename],
    });
    const metadata = await buildAptRepositoryMetadata({
      ...enrichedInput,
      existingIndexes: suitePackageIndexes(published),
      existingContents: suiteContentsIndexes(published),
      existingSources: suiteSourceIndexes(published),
      poolFilenames: await poolFilenames(objectStore, input.repository.name),
    });
    const key = await this.options.signingKeys.getActivePrivateKey(
      metadata.config.signingKeyId,
      input.repository.name,
    );
    const publishedAt = input.session.publishStartedAt ?? input.session.finalizingStartedAt ?? input.session.createdAt;
    const written = await writeAptRepositoryIndexes({
      objectStore,
      repositoryName: input.repository.name,
      suites: metadata.suites,
      signer: this.options.signer,
      signingKey: key,
      publishedAt,
      poolCopies: metadata.poolCopies,
    });

    return { publishedAt, objects: written.objects };
  }

  private async enrichArtifactsWithDebControlMetadata(
    input: PublishArtifactsInput,
    config: AptRepositoryConfig,
    objectStore: RepositoryObjectStore,
  ): Promise<PublishArtifactsInput> {
    return {
      ...input,
      artifacts: await Promise.all(
        input.artifacts.map((artifact) => this.enrichArtifact(artifact, config, objectStore)),
      ),
    };
  }

  private async enrichArtifact(
    artifact: PublishedArtifactInput,
    config: AptRepositoryConfig,
    objectStore: RepositoryObjectStore,
  ): Promise<PublishedArtifactInput> {
    const kind = aptArtifactKind(artifact.artifact.filename);
    if (kind === "source-component") {
      // A tarball carries no metadata of its own; the .dsc describes it.
      return artifact;
    }

    if (kind === "source") {
      // A .dsc is a few kilobytes of text, so it is read whole.
      const object = await objectStore.getObject(artifact.verified.objectKey);
      if (!object) {
        throw new ValidationError("APT artifact upload object could not be read for metadata parsing");
      }
      return {
        ...artifact,
        artifact: {
          ...artifact.artifact,
          metadata: {
            ...artifact.artifact.metadata,
            dscText: textDecoder.decode(await objectBytes(object)),
          },
        },
      };
    }

    // A .deb is read where it lies. Uploads may be gigabytes, and pulling one
    // into a worker's 128 MB heap to read a few kilobytes of control fields
    // would put a ceiling on package size that nothing else here imposes.
    const source = await openUploadedDebArchive(objectStore, artifact.verified.objectKey);
    const control = await readDebControlMetadata(source);
    return {
      ...artifact,
      artifact: {
        ...artifact.artifact,
        metadata: {
          ...aptArtifactMetadataFromDebControl({
            config,
            artifact: artifact.artifact,
            control,
          }),
          // Read while the archive is already located; Contents would
          // otherwise have to walk every .deb again.
          filePaths: await readDebFilePaths(source),
        },
      },
    };
  }
}

/**
 * Lists what the pool already holds, as repository-relative paths.
 *
 * A `.dsc` may point at an `.orig.tar` uploaded with an earlier revision, so
 * publishing has to be able to see that it is already there rather than
 * demanding it again.
 */
async function poolFilenames(objectStore: RepositoryObjectStore, repositoryName: string): Promise<Set<string>> {
  const prefix = `repositories/${repositoryName}/`;
  const objects = await listAllObjects(objectStore, `${prefix}pool/`);
  return new Set(objects.map((object) => object.key.slice(prefix.length)));
}

export function aptArtifactMetadataFromDebControl(input: {
  config: AptRepositoryConfig;
  artifact: PublishArtifactRequest;
  control: DebControlMetadata;
}): Record<string, unknown> {
  const existing = input.artifact.metadata;
  // Read the parsed config rather than reaching into config.apt directly: the
  // namespace belongs to the manifest, and parseAptRepositoryConfig has already
  // validated these values.
  const configuredComponents = input.config.components;
  const defaultComponent = configuredComponents?.length === 1 ? configuredComponents[0] : undefined;
  const metadata: Record<string, unknown> = {
    package: input.control.package,
    version: input.control.version,
    architecture: input.control.architecture,
    component: metadataString(existing, "component") ?? defaultComponent,
    // The suite is the publisher's choice, not something the .deb can state,
    // so it has to survive being overwritten by the parsed control fields.
    suite: metadataString(existing, "suite"),
    description: input.control.description,
    maintainer: input.control.maintainer,
  };

  for (const [controlField, metadataField] of debControlMetadataFields) {
    metadata[metadataField] = input.control[controlField];
  }

  return metadata;
}

function metadataString(metadata: Record<string, unknown>, field: string): string | undefined {
  const value = metadata[field];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
