import {
  type CreatePublishSessionInput,
  type CreateRepositoryInput,
  type FinalizePublishSessionInput,
  type FinalizePublishSessionResult,
  type GetPublishSessionInput,
  type ListPublishSessionsInput,
  NotFoundError,
  type PublishSession,
  PublishSessionService,
  type Repository,
  RepositoryService,
  type TokenPrincipal,
  type UpdateRepositoryInput,
  type VerifyPublishUploadInput,
  type VerifyPublishUploadResult,
} from "@axis-repository/core";
import type { ArtifactPublisherRegistry } from "./artifact-publisher-registry";

export class PluginRepositoryService {
  constructor(
    private readonly options: {
      repositoryService: RepositoryService;
      plugins: ArtifactPublisherRegistry;
    },
  ) {}

  create(input: CreateRepositoryInput): Promise<Repository> {
    const plugin = this.options.plugins.requirePlugin(input.ecosystem);
    plugin.validateRepositoryConfig({
      ecosystem: input.ecosystem,
      config: input.config ?? {},
    });
    return this.options.repositoryService.create(input);
  }

  list(): Promise<Repository[]> {
    return this.options.repositoryService.list();
  }

  getByName(name: string): Promise<Repository> {
    return this.options.repositoryService.getByName(name);
  }

  async update(name: string, input: UpdateRepositoryInput): Promise<Repository> {
    const current = await this.options.repositoryService.getByName(name);
    const nextConfig = input.config ?? current.config;
    const plugin = this.options.plugins.requirePlugin(current.ecosystem);
    plugin.validateRepositoryConfig({
      ecosystem: current.ecosystem,
      config: nextConfig,
    });
    return this.options.repositoryService.update(name, input);
  }
}

export class PluginPublishSessionService {
  constructor(
    private readonly options: {
      publishSessionService: PublishSessionService;
      repositoryService: RepositoryService;
      plugins: ArtifactPublisherRegistry;
    },
  ) {}

  async create(input: CreatePublishSessionInput): Promise<PublishSession> {
    const repository = await this.options.repositoryService.getByName(input.repositoryName);
    const plugin = this.options.plugins.requirePlugin(repository.ecosystem);
    plugin.validatePublishArtifacts({
      repository,
      artifacts: input.artifacts,
    });
    plugin.authorizePublish({
      repository,
      principal: input.principal,
      artifacts: input.artifacts,
    });
    return this.options.publishSessionService.create(input);
  }

  async createAsAdmin(input: Omit<CreatePublishSessionInput, "principal">): Promise<PublishSession> {
    const repository = await this.options.repositoryService.getByName(input.repositoryName);
    const plugin = this.options.plugins.requirePlugin(repository.ecosystem);
    plugin.validatePublishArtifacts({
      repository,
      artifacts: input.artifacts,
    });
    return this.options.publishSessionService.create({
      ...input,
      principal: adminPublishPrincipal(repository),
    });
  }

  list(input: ListPublishSessionsInput): Promise<PublishSession[]> {
    return this.options.publishSessionService.list(input);
  }

  listAll(): Promise<PublishSession[]> {
    return this.options.publishSessionService.listAll();
  }

  get(input: GetPublishSessionInput): Promise<PublishSession> {
    return this.options.publishSessionService.get(input);
  }

  async verifyUploadAsAdmin(input: Omit<VerifyPublishUploadInput, "principal">): Promise<VerifyPublishUploadResult> {
    const session = await this.getExistingSession(input.sessionId);
    return this.options.publishSessionService.verifyUpload({
      ...input,
      principal: adminPublishPrincipal({ name: session.repositoryName, config: {} }),
    });
  }

  verifyUpload(input: VerifyPublishUploadInput): Promise<VerifyPublishUploadResult> {
    return this.options.publishSessionService.verifyUpload(input);
  }

  async finalizeAsAdmin(input: Omit<FinalizePublishSessionInput, "principal">): Promise<FinalizePublishSessionResult> {
    const session = await this.getExistingSession(input.sessionId);
    return this.options.publishSessionService.finalize({
      ...input,
      principal: adminPublishPrincipal({ name: session.repositoryName, config: session.repositoryName ? {} : {} }),
    });
  }

  finalize(input: FinalizePublishSessionInput): Promise<FinalizePublishSessionResult> {
    return this.options.publishSessionService.finalize(input);
  }

  private async getExistingSession(sessionId: string): Promise<PublishSession> {
    const session = (await this.options.publishSessionService.listAll()).find((candidate) => candidate.id === sessionId);
    if (!session) {
      throw new NotFoundError(`Publish session not found: ${sessionId}`);
    }
    return session;
  }
}

function adminPublishPrincipal(repository: Pick<Repository, "name" | "config">): TokenPrincipal {
  return {
    tokenId: "admin",
    name: "admin",
    permissions: ["publish"],
    repositories: [repository.name],
    ecosystemScopes: {},
    signingKeyIds: signingKeyIdsFromConfig(repository.config),
  };
}

function signingKeyIdsFromConfig(config: Record<string, unknown>): string[] {
  const aptConfig = config.apt;
  if (!aptConfig || typeof aptConfig !== "object" || Array.isArray(aptConfig)) {
    return [];
  }
  const signingKeyId = (aptConfig as Record<string, unknown>).signingKeyId;
  return typeof signingKeyId === "string" ? [signingKeyId] : [];
}
