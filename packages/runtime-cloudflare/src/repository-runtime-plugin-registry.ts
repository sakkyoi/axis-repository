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
import type {
  PluginClientHelperActionManifest,
  PluginClientHelperResponseKind,
} from "@axis-repository/core/plugin-manifests";

export interface RepositoryClientHelperSigningKey {
  publicKeyArmored: string;
}

export interface RepositoryPublicSigningKey {
  id: string;
  repositoryName: string;
  name: string;
  publicKeyArmored: string;
  fingerprint: string;
  keyId: string;
  createdAt: string;
  revokedAt: string | null;
}

export interface RepositoryActivePrivateSigningKey {
  id: string;
  repositoryName: string;
  privateKeyArmored: string;
  passphrase: string;
  fingerprint: string;
  keyId: string;
}

export interface RepositorySigningKeyCapability {
  listForRepository(repositoryName: string): Promise<RepositoryPublicSigningKey[]>;
  create(input: {
    repositoryName: string;
    name: string;
    privateKeyArmored: string;
    passphrase: string;
  }): Promise<RepositoryPublicSigningKey>;
  generate(input: {
    repositoryName: string;
    name: string;
    userIdName: string;
    userIdEmail: string;
  }): Promise<RepositoryPublicSigningKey>;
  getPublicKey(id: string): Promise<RepositoryPublicSigningKey>;
  getActivePrivateKey(id: string): Promise<RepositoryActivePrivateSigningKey>;
  revoke(id: string): Promise<RepositoryPublicSigningKey>;
}

export type RepositoryClientHelperResponseKind = PluginClientHelperResponseKind;
export type RepositoryClientHelperAction = PluginClientHelperActionManifest;

export interface PublisherMetadata {
  ecosystem: Ecosystem;
  name: string;
  version: string;
  capabilities: string[];
  clientHelpers?: {
    namespace: string;
    actions: RepositoryClientHelperAction[];
  };
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

export interface DerivedPublishPrincipalScope {
  ecosystemScopes?: Record<string, unknown>;
  signingKeyIds?: string[];
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
  actions: RepositoryClientHelperAction[];
  isPublic(action: string): boolean;
  handle(input: RepositoryClientHelperInput): Promise<Response>;
}

export interface RepositoryAdminResourceServices {
  signingKeys?: RepositorySigningKeyCapability;
  [name: string]: unknown;
}

export interface RepositoryAdminResourceInput {
  repositoryName: string;
  repository?: Repository;
  request: Request;
  path: string[];
  services: RepositoryAdminResourceServices;
}

export interface RepositoryAdminResources {
  namespace: string;
  handle(input: RepositoryAdminResourceInput): Promise<Response>;
}

export interface RepositoryPublishLifecycle {
  validateArtifacts(input: ValidatePublishArtifactsInput): void;
  derivePrincipalScope?(repository: Repository): DerivedPublishPrincipalScope;
  authorize(input: AuthorizePublishInput): void;
  finalize(input: PublishArtifactsInput): Promise<PublishResult>;
}

export interface ArtifactRepositoryPlugin extends PublisherMetadata {
  publish: RepositoryPublishLifecycle;
  canServeRepositoryPath: RepositoryPathServingRule;
  validateRepositoryConfig(input: ValidateRepositoryConfigInput): void;
  clientHelpers?: RepositoryClientHelpers;
  adminResources?: RepositoryAdminResources;
}

export type RepositoryRuntimePluginDescriptor = ArtifactRepositoryPlugin;

function clonePlugin(descriptor: ArtifactRepositoryPlugin): ArtifactRepositoryPlugin {
  return {
    ...descriptor,
    capabilities: [...descriptor.capabilities],
    ...(descriptor.clientHelpers
      ? {
          clientHelpers: {
            ...descriptor.clientHelpers,
            actions: descriptor.clientHelpers.actions.map((action) => ({ ...action })),
          },
        }
      : {}),
    ...(descriptor.adminResources
      ? {
          adminResources: {
            ...descriptor.adminResources,
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

export class RepositoryRuntimePluginRegistry implements ArtifactPublisher {
  private readonly plugins = new Map<Ecosystem, ArtifactRepositoryPlugin>();

  register(descriptor: RepositoryRuntimePluginDescriptor): void {
    if (this.plugins.has(descriptor.ecosystem)) {
      throw new ValidationError(
        `Artifact publisher is already registered for ecosystem: ${descriptor.ecosystem}`,
      );
    }
    this.plugins.set(descriptor.ecosystem, clonePlugin(descriptor));
  }

  list(): PublisherMetadata[] {
    return Array.from(this.plugins.values()).map((descriptor) => {
      const metadata: PublisherMetadata = {
        ecosystem: descriptor.ecosystem,
        name: descriptor.name,
        version: descriptor.version,
        capabilities: [...descriptor.capabilities],
      };
      if (descriptor.clientHelpers) {
        metadata.clientHelpers = {
          namespace: descriptor.clientHelpers.namespace,
          actions: descriptor.clientHelpers.actions.map((action) => ({ ...action })),
        };
      }
      return metadata;
    });
  }

  getPlugin(ecosystem: Ecosystem): ArtifactRepositoryPlugin | undefined {
    const plugin = this.plugins.get(ecosystem);
    if (!plugin) return undefined;
    return clonePlugin(plugin);
  }

  getPluginByAdminResourceNamespace(namespace: string): ArtifactRepositoryPlugin | undefined {
    const plugin = Array.from(this.plugins.values()).find((descriptor) =>
      descriptor.adminResources?.namespace === namespace,
    );
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
    return descriptor.publish.finalize(input);
  }
}
