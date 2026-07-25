import type {
  Ecosystem,
  PublishArtifactRequest,
  PublishArtifactsInput,
  PublishResult,
  Repository,
  RepositoryArtifactRecord,
  TokenPrincipal,
} from "@axis-repository/core";
import type { RepositoryAdminResources } from "./repository-plugin-admin-resources";
import type {
  RepositoryClientHelperAction,
  RepositoryClientHelpers,
} from "./repository-plugin-client-helpers";

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

export interface DescribePublishedArtifactsInput {
  repository: Repository;
  session: PublishArtifactsInput["session"];
  result: PublishResult;
}

export interface DerivedPublishPrincipalScope {
  ecosystemScopes?: Record<string, unknown>;
  signingKeyIds?: string[];
}

export interface RepositoryPublishLifecycle {
  validateArtifacts(input: ValidatePublishArtifactsInput): void;
  derivePrincipalScope?(repository: Repository): DerivedPublishPrincipalScope;
  authorize(input: AuthorizePublishInput): void;
  finalize(input: PublishArtifactsInput): Promise<PublishResult>;
  describeArtifacts?(input: DescribePublishedArtifactsInput): RepositoryArtifactRecord[];
}

export interface ArtifactRepositoryPlugin extends PublisherMetadata {
  publish: RepositoryPublishLifecycle;
  canServeRepositoryPath: RepositoryPathServingRule;
  validateRepositoryConfig(input: ValidateRepositoryConfigInput): void;
  clientHelpers?: RepositoryClientHelpers;
  adminResources?: RepositoryAdminResources;
}

export type RepositoryRuntimePluginDescriptor = ArtifactRepositoryPlugin;

export function createPrefixServingPredicate(prefixes: string[]): RepositoryPathServingRule {
  const normalizedPrefixes = prefixes.map((prefix) => prefix.replace(/^\/+|\/+$/g, ""));
  return ({ relativePath }) =>
    normalizedPrefixes.some((prefix) => relativePath === prefix || relativePath.startsWith(`${prefix}/`));
}
