import {
  ValidationError,
  type ArtifactPublisher,
  type PublishArtifactsInput,
  type PublishResult,
  type PublishedObject,
  type RepositoryObjectMetadata,
  type RepositoryObjectStore,
} from "@axis-repository/core";
import { packageObjectKey } from "./layout";
import { requireDistributionFilename } from "./names";

const DEFAULT_CONTENT_TYPE = "application/octet-stream";

/**
 * Moves a session's uploads into the repository.
 *
 * An upload lands in staging, which is scoped to the session and is not part
 * of what the repository serves. Publishing copies it to the packages tree,
 * under the project the filename names, which is the only place a client can
 * fetch it from.
 */
export class PypiPublisher implements ArtifactPublisher {
  constructor(
    private readonly options: {
      /** Resolves the store for the repository being published to. */
      objectStoreFor: (repositoryName: string) => RepositoryObjectStore;
      now?: () => Date;
    },
  ) {}

  async publish(input: PublishArtifactsInput): Promise<PublishResult> {
    const objectStore = this.options.objectStoreFor(input.repository.name);
    const publishedAt = input.session.publishStartedAt
      ?? input.session.finalizingStartedAt
      ?? (this.options.now ?? (() => new Date()))().toISOString();

    const copies = input.artifacts.map(({ artifact, verified }) => {
      const distribution = requireDistributionFilename(artifact.filename);
      return {
        sourceKey: verified.objectKey,
        destinationKey: packageObjectKey(input.repository.name, distribution, artifact.filename),
        contentType: artifact.contentType || DEFAULT_CONTENT_TYPE,
      };
    });

    // Two files in one session cannot claim the same path: the second copy
    // would silently replace the first and the session would report both as
    // published.
    const destinations = new Set<string>();
    for (const copy of copies) {
      if (destinations.has(copy.destinationKey)) {
        throw new ValidationError(
          `PyPI publish contains the same distribution twice: ${copy.destinationKey.split("/").pop()}`,
        );
      }
      destinations.add(copy.destinationKey);
    }

    const previous = new Map<string, RepositoryObjectMetadata | null>(
      await Promise.all(copies.map(async (copy) => [
        copy.destinationKey,
        await objectStore.headObject(copy.destinationKey),
      ] as const)),
    );

    for (const copy of copies) {
      await objectStore.copyObject(copy.sourceKey, copy.destinationKey, copy.contentType);
    }

    return {
      publishedAt,
      objects: copies.map((copy) => withPreviousMetadata(
        { key: copy.destinationKey, contentType: copy.contentType },
        previous.get(copy.destinationKey) ?? null,
      )),
    };
  }
}

function withPreviousMetadata(
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
