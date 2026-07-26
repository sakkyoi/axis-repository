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
  type RepositoryActivityService,
  PublishSessionService,
  type Repository,
  type RepositoryArtifactRecord,
  type RepositoryArtifactStore,
  type RepositoryObjectStore,
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
import type { DeleteRepositoryArtifactResult } from "../plugins/repository-plugin-contract";

export interface CreatePluginRepositoryInput extends CreateRepositoryInput {
  provisioning?: Record<string, unknown>;
}

export class PluginRepositoryService {
  constructor(
    private readonly options: {
      repositoryService: RepositoryService;
      plugins: RepositoryRuntimePluginRegistry;
      pluginPolicyService: PluginPolicyService;
    },
  ) {}

  async create(input: CreatePluginRepositoryInput): Promise<Repository> {
    await this.ensurePluginEnabled(input.ecosystem);
    const plugin = this.options.plugins.requirePlugin(input.ecosystem);
    let config = input.config ?? {};
    if (input.provisioning !== undefined) {
      if (!plugin.create) {
        throw new ValidationError(`Repository create provisioning is not configured for ecosystem: ${input.ecosystem}`);
      }
      try {
        await this.options.repositoryService.getByName(input.name);
        throw new ValidationError(`Repository already exists: ${input.name.trim()}`);
      } catch (error) {
        if (!(error instanceof NotFoundError)) throw error;
      }
      const provisioningInput = {
        repositoryName: input.name.trim(),
        ecosystem: input.ecosystem,
        visibility: input.visibility ?? "private",
        config,
        provisioning: input.provisioning,
      };
      plugin.create.validateProvisioning(provisioningInput);
      const result = await plugin.create.provision(provisioningInput);
      config = mergeConfigPatch(config, result?.configPatch ?? {});
    }
    plugin.validateRepositoryConfig({
      ecosystem: input.ecosystem,
      config,
    });
    return this.options.repositoryService.create({
      ...input,
      config,
    });
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

  async delete(name: string): Promise<void> {
    await this.options.repositoryService.delete(name);
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
      repositoryActivityService?: RepositoryActivityService;
      repositoryArtifactStore?: RepositoryArtifactStore;
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

  async getAsAdmin(input: { sessionId: string }): Promise<PublishSession> {
    return this.getExistingSession(input.sessionId);
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
    return this.finalizeAndRecordUpdates({
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
    return this.finalizeAndRecordUpdates(input);
  }

  private async finalizeAndRecordUpdates(input: FinalizePublishSessionInput): Promise<FinalizePublishSessionResult> {
    const result = await this.options.publishSessionService.finalize(input);
    const repository = await this.options.repositoryService.getByName(result.session.repositoryName);
    const plugin = this.options.plugins.requirePlugin(repository.ecosystem);
    const repositoryArtifactStore = this.options.repositoryArtifactStore;
    if (repositoryArtifactStore) {
      for (const artifact of plugin.publish.describeArtifacts?.({
        repository,
        session: result.session,
        result: result.result,
      }) ?? []) {
        await repositoryArtifactStore.upsert(artifact);
      }
    }
    const repositoryActivityService = this.options.repositoryActivityService;
    if (!repositoryActivityService) {
      return result;
    }
    await Promise.all(result.result.objects
      .filter((object) => object.previous)
      .map((object) => repositoryActivityService.recordObjectUpdate({
        repositoryName: result.session.repositoryName,
        path: repositoryRelativeObjectPath(result.session.repositoryName, object.key),
        objectKey: object.key,
        contentType: object.contentType,
        ...(object.previous?.contentType !== undefined ? { previousContentType: object.previous.contentType } : {}),
        ...(object.previous?.size !== undefined ? { previousSize: object.previous.size } : {}),
        ...(object.previous?.etag !== undefined ? { previousEtag: object.previous.etag } : {}),
      })));
    return result;
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

export class PluginRepositoryArtifactIndexService {
  constructor(
    private readonly options: {
      repositoryService: RepositoryService;
      plugins: RepositoryRuntimePluginRegistry;
      repositoryObjectStore: RepositoryObjectStore;
      repositoryArtifactStore: RepositoryArtifactStore;
      clock: { now(): Date };
    },
  ) {}

  async rebuild(input: { repositoryName: string }): Promise<{ artifacts: RepositoryArtifactRecord[] }> {
    const repository = await this.options.repositoryService.getByName(input.repositoryName);
    const plugin = this.options.plugins.requirePlugin(repository.ecosystem);
    const artifacts = await plugin.artifacts?.rebuildIndex({
      repository,
      objectStore: this.options.repositoryObjectStore,
      now: this.options.clock.now(),
    }) ?? [];
    await this.options.repositoryArtifactStore.replaceByRepository(repository.name, artifacts);
    return { artifacts };
  }

  async deleteArtifact(input: {
    repositoryName: string;
    artifactId: string;
  }): Promise<DeleteRepositoryArtifactResult & {
    artifact: RepositoryArtifactRecord;
    artifacts: RepositoryArtifactRecord[];
  }> {
    const repository = await this.options.repositoryService.getByName(input.repositoryName);
    const plugin = this.options.plugins.requirePlugin(repository.ecosystem);
    const artifacts = await this.options.repositoryArtifactStore.listByRepository(repository.name);
    const artifact = artifacts.find((candidate) => candidate.id === input.artifactId);
    if (!artifact) {
      throw new NotFoundError();
    }
    const deleteResult = await plugin.artifacts?.deleteArtifact?.({
      repository,
      artifact,
      objectStore: this.options.repositoryObjectStore,
    }) ?? await this.deleteArtifactObjects(repository, artifact);
    const rebuildResult = await this.rebuild({ repositoryName: repository.name });
    return {
      artifact,
      ...deleteResult,
      artifacts: rebuildResult.artifacts,
    };
  }

  private async deleteArtifactObjects(
    repository: Repository,
    artifact: RepositoryArtifactRecord,
  ): Promise<DeleteRepositoryArtifactResult> {
    const deletedObjectKeys: string[] = [];
    const missingObjectKeys: string[] = [];
    const skippedObjectKeys: string[] = [];
    const failedObjectKeys: DeleteRepositoryArtifactResult["failedObjectKeys"] = [];
    for (const objectKey of artifact.objectKeys) {
      if (!objectKey.startsWith(`repositories/${repository.name}/`)) {
        skippedObjectKeys.push(objectKey);
        continue;
      }
      try {
        if (await this.options.repositoryObjectStore.deleteObject(objectKey)) {
          deletedObjectKeys.push(objectKey);
        } else {
          missingObjectKeys.push(objectKey);
        }
      } catch (error) {
        failedObjectKeys.push({
          objectKey,
          message: error instanceof Error ? error.message : "unknown delete error",
        });
      }
    }
    return {
      deletedObjectKeys,
      missingObjectKeys,
      skippedObjectKeys,
      failedObjectKeys,
    };
  }
}

function repositoryRelativeObjectPath(repositoryName: string, objectKey: string): string {
  const prefix = `repositories/${repositoryName}/`;
  return objectKey.startsWith(prefix) ? objectKey.slice(prefix.length) : objectKey;
}

function mergeConfigPatch(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const current = merged[key];
    if (isRecord(current) && isRecord(value)) {
      merged[key] = mergeConfigPatch(current, value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
