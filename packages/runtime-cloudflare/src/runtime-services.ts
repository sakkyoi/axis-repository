import {
  type CreatePublishSessionInput,
  type CreateRepositoryInput,
  type FinalizePublishSessionInput,
  type FinalizePublishSessionResult,
  type GetPublishSessionInput,
  type ListPublishSessionsInput,
  type PublishSession,
  PublishSessionService,
  type Repository,
  RepositoryService,
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

  list(input: ListPublishSessionsInput): Promise<PublishSession[]> {
    return this.options.publishSessionService.list(input);
  }

  listAll(): Promise<PublishSession[]> {
    return this.options.publishSessionService.listAll();
  }

  get(input: GetPublishSessionInput): Promise<PublishSession> {
    return this.options.publishSessionService.get(input);
  }

  verifyUpload(input: VerifyPublishUploadInput): Promise<VerifyPublishUploadResult> {
    return this.options.publishSessionService.verifyUpload(input);
  }

  finalize(input: FinalizePublishSessionInput): Promise<FinalizePublishSessionResult> {
    return this.options.publishSessionService.finalize(input);
  }
}
