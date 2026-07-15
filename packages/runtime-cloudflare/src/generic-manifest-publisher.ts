import type {
  ArtifactPublisher,
  PublishArtifactsInput,
  PublishResult,
  RepositoryObjectStore,
} from "@axis-repository/core";
import { JSON_CONTENT_TYPE } from "./repository-object-store";

export interface GenericManifestPublisherOptions {
  objectStore: RepositoryObjectStore;
  now?: () => Date;
}

export class GenericManifestPublisher implements ArtifactPublisher {
  private readonly objectStore: RepositoryObjectStore;
  private readonly now: () => Date;

  constructor(options: GenericManifestPublisherOptions) {
    this.objectStore = options.objectStore;
    this.now = options.now ?? (() => new Date());
  }

  async publish(input: PublishArtifactsInput): Promise<PublishResult> {
    const publishedAt = this.now().toISOString();
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
    const latestKey = `repositories/${input.repository.name}/latest.json`;
    const objects = [
      {
        key: publishKey,
        contentType: JSON_CONTENT_TYPE,
      },
      {
        key: latestKey,
        contentType: JSON_CONTENT_TYPE,
      },
    ];

    await this.objectStore.putJson(publishKey, manifest);
    await this.objectStore.putJson(latestKey, manifest);

    return {
      objects,
      publishedAt,
    };
  }
}
