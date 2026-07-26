import type {
  ArtifactPublisher,
  PublishedObject,
  PublishArtifactsInput,
  PublishResult,
  RepositoryObjectMetadata,
} from "@axis-repository/core";
import { JSON_CONTENT_TYPE } from "../storage/repository-object-store";
import type { RepositoryObjectStoreFactory } from "./scoped-capabilities";

export interface GenericManifestPublisherOptions {
  /** Resolves the store for the repository being published to. */
  objectStoreFor: RepositoryObjectStoreFactory;
  now?: () => Date;
}

export class GenericManifestPublisher implements ArtifactPublisher {
  private readonly objectStoreFor: RepositoryObjectStoreFactory;
  private readonly now: () => Date;

  constructor(options: GenericManifestPublisherOptions) {
    this.objectStoreFor = options.objectStoreFor;
    this.now = options.now ?? (() => new Date());
  }

  async publish(input: PublishArtifactsInput): Promise<PublishResult> {
    const objectStore = this.objectStoreFor(input.repository.name);
    const publishedAt = input.session.publishStartedAt ?? input.session.finalizingStartedAt ?? this.now().toISOString();
    const manifest = {
      repository: input.repository.name,
      ecosystem: input.repository.ecosystem,
      sessionId: input.session.id,
      publishedAt,
      artifacts: input.artifacts.map(({ artifact, verified }) => ({
        filename: artifact.filename,
        contentType: artifact.contentType,
        size: verified.size,
        sha256: verified.sha256,
        objectKey: verified.objectKey,
        metadata: artifact.metadata,
      })),
    };
    const publishKey = `repositories/${input.repository.name}/publishes/${input.session.id}.json`;
    const previous = await objectStore.headObject(publishKey);
    const objects = [
      {
        key: publishKey,
        contentType: JSON_CONTENT_TYPE,
        ...publishedObjectPrevious(previous),
      },
    ];

    await objectStore.putJson(publishKey, manifest);

    return {
      objects,
      publishedAt,
    };
  }
}

function publishedObjectPrevious(previous: RepositoryObjectMetadata | null): Pick<PublishedObject, "previous"> | Record<string, never> {
  if (!previous) {
    return {};
  }
  return {
    previous: {
      ...(previous.contentType !== undefined ? { contentType: previous.contentType } : {}),
      ...(previous.contentLength !== undefined ? { size: previous.contentLength } : {}),
      ...(previous.etag !== undefined ? { etag: previous.etag } : {}),
    },
  };
}
