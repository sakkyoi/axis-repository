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
  /**
   * The requested path, relative to the repository, keeping any trailing
   * slash: `simple/` and `simple` are different requests to a format that
   * serves directory indexes.
   */
  relativePath: string;
  /** The request's `Accept` header, for formats served in more than one shape. */
  accept?: string;
}

export type RepositoryPathServingRule = (context: RepositoryServingContext) => boolean;

export interface RepositoryPathResolution {
  /** The stored object to answer with, relative to the repository. */
  objectPath: string;
  /** Content type to answer with, when it differs from how the object was stored. */
  contentType?: string;
}

/**
 * Maps a requested path to the object that answers it.
 *
 * Most formats address their objects directly, and a plugin that does needs
 * none of this. It exists for formats whose URLs are not object keys: the
 * Simple API asks for `simple/foo/`, a directory, and the same URL answers
 * with HTML or JSON depending on what the client accepts.
 */
export type RepositoryPathResolver = (
  context: RepositoryServingContext,
) => RepositoryPathResolution | null;

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

export interface ParsedProtocolUpload {
  artifact: PublishArtifactRequest;
  body: Uint8Array;
}

/**
 * An ecosystem's own upload protocol, for clients that do not speak this
 * repository's publish-session API.
 *
 * `twine` posts a package in one request, where a session is created,
 * uploaded to, verified and finalized in four. The plugin knows that wire
 * format; the session lifecycle it maps onto is the same for everyone, so it
 * stays in the worker.
 */
export interface RepositoryUploadProtocol {
  /** The path under the repository this protocol answers POSTs on. */
  path: string;
  parseUpload(request: Request): Promise<ParsedProtocolUpload[]>;
  /** How this protocol reports success; a bare 200 by default. */
  successResponse?(): Response;
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
  /** Defaults to serving the requested path as the object key. */
  resolveRepositoryPath?: RepositoryPathResolver;
  /** An ecosystem-native upload protocol, for clients like `twine`. */
  uploadProtocol?: RepositoryUploadProtocol;
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
