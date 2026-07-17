import {
  ValidationError,
  type ArtifactPublisher,
  type Ecosystem,
  type PublishArtifactsInput,
  type PublishResult,
} from "@axis-repository/core";

export interface PublisherMetadata {
  ecosystem: Ecosystem;
  name: string;
  version: string;
  capabilities: string[];
}

export interface PublisherDescriptor extends PublisherMetadata {
  publisher: ArtifactPublisher;
}

export class ArtifactPublisherRegistry implements ArtifactPublisher {
  private readonly publishers = new Map<Ecosystem, PublisherDescriptor>();

  register(descriptor: PublisherDescriptor): void {
    if (this.publishers.has(descriptor.ecosystem)) {
      throw new ValidationError(
        `Artifact publisher is already registered for ecosystem: ${descriptor.ecosystem}`,
      );
    }
    this.publishers.set(descriptor.ecosystem, {
      ...descriptor,
      capabilities: [...descriptor.capabilities],
    });
  }

  list(): PublisherMetadata[] {
    return Array.from(this.publishers.values()).map((descriptor) => ({
      ecosystem: descriptor.ecosystem,
      name: descriptor.name,
      version: descriptor.version,
      capabilities: [...descriptor.capabilities],
    }));
  }

  async publish(input: PublishArtifactsInput): Promise<PublishResult> {
    const descriptor = this.publishers.get(input.repository.ecosystem);
    if (!descriptor) {
      throw new ValidationError(
        `Artifact publisher is not configured for ecosystem: ${input.repository.ecosystem}`,
      );
    }
    return descriptor.publisher.publish(input);
  }
}
