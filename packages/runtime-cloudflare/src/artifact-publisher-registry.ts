import {
  ValidationError,
  type ArtifactPublisher,
  type Ecosystem,
  type PublishArtifactRequest,
  type PublishArtifactsInput,
  type PublishResult,
  type Repository,
  type TokenPrincipal,
} from "@axis-repository/core";

export interface RepositoryClientHelperSigningKey {
  publicKeyArmored: string;
}

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

export interface ValidateRepositoryConfigInput {
  ecosystem: Ecosystem;
  config: Record<string, unknown>;
}

export interface ValidatePublishArtifactsInput {
  repository: Repository;
  artifacts: PublishArtifactRequest[];
}

export interface AuthorizePublishInput extends ValidatePublishArtifactsInput {
  principal: TokenPrincipal;
}

export interface RepositoryClientHelperContext {
  origin: string;
  signingKeys: {
    getPublicKey(id: string): Promise<RepositoryClientHelperSigningKey>;
  };
}

export interface RepositoryClientHelperInput extends RepositoryClientHelperContext {
  repository: Repository;
  action: string;
}

export interface RepositoryClientHelpers {
  namespace: string;
  actions: string[];
  isPublic(action: string): boolean;
  handle(input: RepositoryClientHelperInput): Promise<Response>;
}

export interface ArtifactRepositoryPlugin extends PublisherMetadata {
  publisher: ArtifactPublisher;
  canServeRepositoryPath: RepositoryPathServingRule;
  validateRepositoryConfig(input: ValidateRepositoryConfigInput): void;
  validatePublishArtifacts(input: ValidatePublishArtifactsInput): void;
  authorizePublish(input: AuthorizePublishInput): void;
  clientHelpers?: RepositoryClientHelpers;
}

export type PublisherDescriptor = ArtifactRepositoryPlugin;

function clonePlugin(descriptor: ArtifactRepositoryPlugin): ArtifactRepositoryPlugin {
  return {
    ...descriptor,
    capabilities: [...descriptor.capabilities],
    ...(descriptor.clientHelpers
      ? {
          clientHelpers: {
            ...descriptor.clientHelpers,
            actions: [...descriptor.clientHelpers.actions],
          },
        }
      : {}),
  };
}

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
    this.plugins.set(descriptor.ecosystem, clonePlugin(descriptor));
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
    return clonePlugin(plugin);
  }

  requirePlugin(ecosystem: Ecosystem): ArtifactRepositoryPlugin {
    const plugin = this.getPlugin(ecosystem);
    if (!plugin) {
      throw new ValidationError(
        `Artifact repository plugin is not configured for ecosystem: ${ecosystem}`,
      );
    }
    return plugin;
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
