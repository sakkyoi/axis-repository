import {
  NotFoundError,
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

export interface RepositorySecretRecord {
  id: string;
  namespace: string;
  repositoryName: string;
  name: string;
  publicMetadata: Record<string, unknown>;
  createdAt: string;
  revokedAt: string | null;
}

export interface RepositoryActiveSecret extends RepositorySecretRecord {
  secrets: Record<string, string>;
}

export interface RepositorySecretCapability {
  createSecretValue(prefix: string): string;
  create(input: {
    namespace: string;
    repositoryName: string;
    name: string;
    publicMetadata: Record<string, unknown>;
    secrets: Record<string, string>;
  }): Promise<RepositorySecretRecord>;
  list(input: { namespace: string; repositoryName?: string }): Promise<RepositorySecretRecord[]>;
  get(id: string): Promise<RepositorySecretRecord>;
  getActive(id: string): Promise<RepositoryActiveSecret>;
  revoke(id: string): Promise<RepositorySecretRecord>;
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
}

export interface RepositoryClientHelperInput extends RepositoryClientHelperContext {
  repository: Repository;
  action: string;
}

export type RepositoryClientHelperActionHandlerInput = Omit<RepositoryClientHelperInput, "action">;

export interface RepositoryClientHelperActionDescriptor extends RepositoryClientHelperAction {
  handle(input: RepositoryClientHelperActionHandlerInput): Promise<Response>;
}

export interface RepositoryClientHelpers {
  namespace: string;
  actions: RepositoryClientHelperActionDescriptor[];
}

export interface RepositoryRuntimePluginServices {
  secrets?: RepositorySecretCapability;
}

export type RepositoryAdminResourceServices = RepositoryRuntimePluginServices;

export interface RepositoryAdminResourceInput {
  repositoryName: string;
  repository?: Repository;
  request: Request;
  path: string[];
  services: RepositoryAdminResourceServices;
}

export interface RepositoryAdminResourceRouteInput extends Omit<RepositoryAdminResourceInput, "path"> {
  params: Record<string, string>;
}

export interface RepositoryAdminResourceRoute {
  method: string;
  path: string[];
  handle(input: RepositoryAdminResourceRouteInput): Promise<Response>;
}

export interface RepositoryAdminResources {
  namespace: string;
  routes: RepositoryAdminResourceRoute[];
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
            routes: descriptor.adminResources.routes.map((route) => ({
              ...route,
              path: [...route.path],
            })),
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

function publicClientHelperAction(action: RepositoryClientHelperActionDescriptor): RepositoryClientHelperAction {
  return {
    name: action.name,
    label: action.label,
    responseKind: action.responseKind,
    defaultOpen: action.defaultOpen,
    public: action.public,
    ...(action.displayPath === undefined ? {} : { displayPath: action.displayPath }),
  };
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
          actions: descriptor.clientHelpers.actions.map(publicClientHelperAction),
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

export async function dispatchRepositoryClientHelper(
  clientHelpers: RepositoryClientHelpers,
  input: RepositoryClientHelperInput,
): Promise<Response> {
  const action = clientHelpers.actions.find((candidate) => candidate.name === input.action);
  if (!action) {
    throw new NotFoundError(`Repository client helper is not configured: ${input.action}`);
  }
  return action.handle({
    repository: input.repository,
    origin: input.origin,
  });
}

function matchAdminResourceRoute(
  route: RepositoryAdminResourceRoute,
  method: string,
  path: readonly string[],
): Record<string, string> | null {
  if (route.method.toUpperCase() !== method.toUpperCase() || route.path.length !== path.length) {
    return null;
  }
  const params: Record<string, string> = {};
  for (let index = 0; index < route.path.length; index += 1) {
    const expected = route.path[index]!;
    const actual = path[index]!;
    if (expected.startsWith(":")) {
      const name = expected.slice(1);
      if (!name) return null;
      params[name] = actual;
      continue;
    }
    if (expected !== actual) {
      return null;
    }
  }
  return params;
}

export async function dispatchRepositoryAdminResource(
  adminResources: RepositoryAdminResources,
  input: RepositoryAdminResourceInput,
): Promise<Response> {
  for (const route of adminResources.routes) {
    const params = matchAdminResourceRoute(route, input.request.method, input.path);
    if (!params) continue;
    return route.handle({
      repositoryName: input.repositoryName,
      ...(input.repository ? { repository: input.repository } : {}),
      request: input.request,
      services: input.services,
      params,
    });
  }
  throw new NotFoundError(
    `Repository admin resource route is not configured: ${input.request.method.toUpperCase()} ${input.path.join("/")}`,
  );
}
