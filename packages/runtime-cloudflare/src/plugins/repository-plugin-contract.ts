import type {
  Ecosystem,
  PublishArtifactRequest,
  PublishArtifactsInput,
  PublishResult,
  Repository,
  RepositoryArtifactRecord,
  RepositoryObjectStore,
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

export interface ValidateRepositoryCreateProvisioningInput {
  repositoryName: string;
  ecosystem: Ecosystem;
  visibility: Repository["visibility"];
  config: Record<string, unknown>;
  provisioning: Record<string, unknown>;
}

export type ProvisionRepositoryCreateInput = ValidateRepositoryCreateProvisioningInput;

export interface RepositoryCreateProvisioningResult {
  configPatch?: Record<string, unknown>;
}

export interface RepositoryCreateLifecycle {
  validateProvisioning(input: ValidateRepositoryCreateProvisioningInput): void;
  provision(input: ProvisionRepositoryCreateInput): Promise<RepositoryCreateProvisioningResult>;
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

export interface RebuildRepositoryArtifactIndexInput {
  repository: Repository;
  objectStore: RepositoryObjectStore;
  now: Date;
}

export interface DeleteRepositoryArtifactInput {
  repository: Repository;
  artifact: RepositoryArtifactRecord;
  objectStore: RepositoryObjectStore;
}

export interface DeleteRepositoryArtifactResult {
  deletedObjectKeys: string[];
  missingObjectKeys: string[];
  skippedObjectKeys: string[];
  failedObjectKeys: Array<{
    objectKey: string;
    message: string;
  }>;
}

export interface RepositoryArtifactIndexLifecycle {
  rebuildIndex(input: RebuildRepositoryArtifactIndexInput): Promise<RepositoryArtifactRecord[]>;
  deleteArtifact?(input: DeleteRepositoryArtifactInput): Promise<DeleteRepositoryArtifactResult>;
}

export interface RepositoryMaintenanceInput {
  repository: Repository;
  objectStore: RepositoryObjectStore;
  now: Date;
}

export interface RepositoryMaintenanceResult {
  /** What was refreshed, for the activity log. Empty when nothing was due. */
  refreshed: string[];
  /** When this repository next needs attention; absent means never. */
  nextDueAt?: Date;
}

/**
 * Work a repository needs on a timer rather than in response to a request.
 *
 * Published metadata can carry an expiry — apt refuses a `Release` whose
 * `Valid-Until` has passed — and a repository that simply has not been
 * published to for a while would otherwise go dark on its own.
 */
export interface RepositoryMaintenanceLifecycle {
  run(input: RepositoryMaintenanceInput): Promise<RepositoryMaintenanceResult>;
}

export interface ArtifactRepositoryPlugin extends PublisherMetadata {
  publish: RepositoryPublishLifecycle;
  artifacts?: RepositoryArtifactIndexLifecycle;
  maintenance?: RepositoryMaintenanceLifecycle;
  create?: RepositoryCreateLifecycle;
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
