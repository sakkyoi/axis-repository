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

export interface RepositoryServingContext {
  relativePath: string;
}

export type RepositoryPathServingRule = (context: RepositoryServingContext) => boolean;

export interface ArtifactRepositoryPlugin extends PublisherMetadata {
  publisher: ArtifactPublisher;
  canServeRepositoryPath: RepositoryPathServingRule;
}

export type PublisherDescriptor = ArtifactRepositoryPlugin;

export function createPrefixServingPredicate(prefixes: string[]): RepositoryPathServingRule {
  const normalizedPrefixes = prefixes.map((prefix) => prefix.replace(/^\/+|\/+$/g, ""));
  return ({ relativePath }) =>
    normalizedPrefixes.some((prefix) => relativePath === prefix || relativePath.startsWith(`${prefix}/`));
}

export class ArtifactPublisherRegistry implements ArtifactPublisher {
  private readonly plugins = new Map<Ecosystem, ArtifactRepositoryPlugin>();

  register(descriptor: PublisherDescriptor): void {
    if (this.plugins.has(descriptor.ecosystem)) {
      throw new ValidationError(
        `Artifact publisher is already registered for ecosystem: ${descriptor.ecosystem}`,
      );
    }
    this.plugins.set(descriptor.ecosystem, {
      ...descriptor,
      capabilities: [...descriptor.capabilities],
    });
  }

  list(): PublisherMetadata[] {
    return Array.from(this.plugins.values()).map((descriptor) => ({
      ecosystem: descriptor.ecosystem,
      name: descriptor.name,
      version: descriptor.version,
      capabilities: [...descriptor.capabilities],
    }));
  }

  getPlugin(ecosystem: Ecosystem): ArtifactRepositoryPlugin | undefined {
    const plugin = this.plugins.get(ecosystem);
    if (!plugin) return undefined;
    return {
      ...plugin,
      capabilities: [...plugin.capabilities],
    };
  }

  async publish(input: PublishArtifactsInput): Promise<PublishResult> {
    const descriptor = this.plugins.get(input.repository.ecosystem);
    if (!descriptor) {
      throw new ValidationError(
        `Artifact publisher is not configured for ecosystem: ${input.repository.ecosystem}`,
      );
    }
    return descriptor.publisher.publish(input);
  }
}
