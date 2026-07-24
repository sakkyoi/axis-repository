import {
  type CreatePublishSessionInput,
  type CreateRepositoryInput,
  type FinalizePublishSessionInput,
  type FinalizePublishSessionResult,
  type GetPublishSessionInput,
  type ListPublishSessionsInput,
  NotFoundError,
  PluginPolicyService,
  type PublishSession,
  PublishSessionService,
  type Repository,
  RepositoryService,
  type TokenPrincipal,
  type UpdateRepositoryInput,
  ValidationError,
  type VerifyPublishUploadInput,
  type VerifyPublishUploadResult,
} from "@axis-repository/core";
import { getRepositoryPluginCatalogEntry } from "../../../../plugins/catalog";
import type { RepositoryRuntimePluginRegistry } from "../plugins/repository-runtime-plugin-registry";
import { ensureRepositoryPluginEnabled } from "../plugins/repository-plugin-policy";

export class PluginRepositoryService {
  constructor(
    private readonly options: {
      repositoryService: RepositoryService;
      plugins: RepositoryRuntimePluginRegistry;
      pluginPolicyService: PluginPolicyService;
    },
  ) {}

  async create(input: CreateRepositoryInput): Promise<Repository> {
    await this.ensurePluginEnabled(input.ecosystem);
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
    await this.ensurePluginEnabled(current.ecosystem);
    const nextConfig = input.config ?? current.config;
    const plugin = this.options.plugins.requirePlugin(current.ecosystem);
    plugin.validateRepositoryConfig({
      ecosystem: current.ecosystem,
      config: nextConfig,
    });
    return this.options.repositoryService.update(name, input);
  }

  private async ensurePluginEnabled(ecosystem: string): Promise<void> {
    await ensureRepositoryPluginEnabled({
      pluginPolicyService: this.options.pluginPolicyService,
      ecosystem,
      catalogEnabled: getRepositoryPluginCatalogEntry(ecosystem)?.enabled ?? true,
    });
  }
}

export class PluginPublishSessionService {
  constructor(
    private readonly options: {
      publishSessionService: PublishSessionService;
      repositoryService: RepositoryService;
      plugins: RepositoryRuntimePluginRegistry;
      pluginPolicyService: PluginPolicyService;
    },
  ) {}

  async create(input: CreatePublishSessionInput): Promise<PublishSession> {
    const repository = await this.options.repositoryService.getByName(input.repositoryName);
    await this.ensurePluginEnabled(repository.ecosystem);
    const plugin = this.options.plugins.requirePlugin(repository.ecosystem);
    plugin.publish.validateArtifacts({
      repository,
      artifacts: input.artifacts,
    });
    plugin.publish.authorize({
      repository,
      principal: input.principal,
      artifacts: input.artifacts,
    });
    return this.options.publishSessionService.create(input);
  }

  async createAsAdmin(input: Omit<CreatePublishSessionInput, "principal">): Promise<PublishSession> {
    const repository = await this.options.repositoryService.getByName(input.repositoryName);
    await this.ensurePluginEnabled(repository.ecosystem);
    const plugin = this.options.plugins.requirePlugin(repository.ecosystem);
    plugin.publish.validateArtifacts({
      repository,
      artifacts: input.artifacts,
    });
    const principal = adminPublishPrincipal(repository, plugin.publish.derivePrincipalScope?.(repository));
    plugin.publish.authorize({
      repository,
      principal,
      artifacts: input.artifacts,
    });
    return this.options.publishSessionService.create({
      ...input,
      principal,
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
      principal: adminPublishPrincipal({ name: session.repositoryName }),
    });
  }

  verifyUpload(input: VerifyPublishUploadInput): Promise<VerifyPublishUploadResult> {
    return this.options.publishSessionService.verifyUpload(input);
  }

  async finalizeAsAdmin(input: Omit<FinalizePublishSessionInput, "principal">): Promise<FinalizePublishSessionResult> {
    const session = await this.getExistingSession(input.sessionId);
    const repository = await this.options.repositoryService.getByName(session.repositoryName);
    await this.ensurePluginEnabled(repository.ecosystem);
    const plugin = this.options.plugins.requirePlugin(repository.ecosystem);
    const principal = adminPublishPrincipal(repository, plugin.publish.derivePrincipalScope?.(repository));
    plugin.publish.authorize({
      repository,
      principal,
      artifacts: session.artifacts,
    });
    return this.options.publishSessionService.finalize({
      ...input,
      principal,
    });
  }

  async finalize(input: FinalizePublishSessionInput): Promise<FinalizePublishSessionResult> {
    const session = await this.getExistingSession(input.sessionId);
    const repository = await this.options.repositoryService.getByName(session.repositoryName);
    await this.ensurePluginEnabled(repository.ecosystem);
    this.options.plugins.requirePlugin(repository.ecosystem).publish.authorize({
      repository,
      principal: input.principal,
      artifacts: session.artifacts,
    });
    return this.options.publishSessionService.finalize(input);
  }

  private async getExistingSession(sessionId: string): Promise<PublishSession> {
    const session = (await this.options.publishSessionService.listAll()).find((candidate) => candidate.id === sessionId);
    if (!session) {
      throw new NotFoundError(`Publish session not found: ${sessionId}`);
    }
    return session;
  }

  private async ensurePluginEnabled(ecosystem: string): Promise<void> {
    await ensureRepositoryPluginEnabled({
      pluginPolicyService: this.options.pluginPolicyService,
      ecosystem,
      catalogEnabled: getRepositoryPluginCatalogEntry(ecosystem)?.enabled ?? true,
    });
  }
}

function adminPublishPrincipal(
  repository: Pick<Repository, "name">,
  scope: { ecosystemScopes?: Record<string, unknown>; signingKeyIds?: string[] } = {},
): TokenPrincipal {
  return {
    tokenId: "admin",
    name: "admin",
    permissions: ["publish"],
    repositories: [repository.name],
    ecosystemScopes: scope.ecosystemScopes ?? {},
    signingKeyIds: scope.signingKeyIds ?? [],
  };
}
