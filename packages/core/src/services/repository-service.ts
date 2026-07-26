import type { Ecosystem, Repository, RepositoryVisibility } from "../domain/domain";
import { NotFoundError, ValidationError } from "../domain/errors";
import type { Clock, RandomId, StateStore } from "../ports/ports";

export interface CreateRepositoryInput {
  name: string;
  ecosystem: Ecosystem;
  visibility?: RepositoryVisibility;
  config?: Record<string, unknown>;
}

export interface UpdateRepositoryInput {
  visibility?: RepositoryVisibility;
  config?: Record<string, unknown>;
}

export interface RepositoryServiceOptions {
  state: StateStore;
  clock: Clock;
  randomId: RandomId;
}

const REPOSITORY_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const REPOSITORY_NAME_MAX_LENGTH = 100;

/**
 * Repository names are concatenated into object keys (`repositories/<name>/...`),
 * durable storage keys (`repository:<name>`), and colon-joined secret index keys.
 * A name containing `/` or `:` makes those key spaces overlap between
 * repositories, so names must be a single safe path segment.
 */
export function assertValidRepositoryName(name: string): void {
  if (!name) {
    throw new ValidationError("Repository name is required");
  }
  if (name.length > REPOSITORY_NAME_MAX_LENGTH) {
    throw new ValidationError(
      `Repository name must be at most ${REPOSITORY_NAME_MAX_LENGTH} characters`,
    );
  }
  if (!REPOSITORY_NAME_PATTERN.test(name)) {
    throw new ValidationError(
      "Repository name must start with a letter or digit and use only letters, digits, dot, underscore, or hyphen",
    );
  }
}

export class RepositoryService {
  constructor(private readonly options: RepositoryServiceOptions) {}

  async create(input: CreateRepositoryInput): Promise<Repository> {
    const name = input.name.trim();
    assertValidRepositoryName(name);
    if (await this.options.state.repositories.getByName(name)) {
      throw new ValidationError(`Repository already exists: ${name}`);
    }

    const now = this.options.clock.now().toISOString();
    const repository: Repository = {
      id: this.options.randomId.create("repo"),
      name,
      ecosystem: input.ecosystem,
      visibility: input.visibility ?? "private",
      config: input.config ?? {},
      createdAt: now,
      updatedAt: now,
    };
    await this.options.state.repositories.save(repository);
    return repository;
  }

  async list(): Promise<Repository[]> {
    return this.options.state.repositories.list();
  }

  async getByName(name: string): Promise<Repository> {
    const repository = await this.options.state.repositories.getByName(name);
    if (!repository) {
      throw new NotFoundError(`Repository not found: ${name}`);
    }
    return repository;
  }

  async update(name: string, input: UpdateRepositoryInput): Promise<Repository> {
    if (input.visibility === undefined && input.config === undefined) {
      throw new ValidationError("Repository update must include visibility or config");
    }
    const repository = await this.getByName(name);
    const updated: Repository = {
      ...repository,
      ...(input.visibility === undefined ? {} : { visibility: input.visibility }),
      ...(input.config === undefined ? {} : { config: input.config }),
      updatedAt: this.options.clock.now().toISOString(),
    };
    await this.options.state.repositories.save(updated);
    return updated;
  }

  async delete(name: string): Promise<void> {
    const repository = await this.getByName(name);
    const now = this.options.clock.now().toISOString();
    const repositorySecrets = await this.options.state.repositorySecrets.list();
    const repositorySecretIds = new Set(
      repositorySecrets
        .filter((secret) => secret.repositoryName === repository.name)
        .map((secret) => secret.id),
    );

    await this.options.state.repositoryArtifacts.replaceByRepository(repository.name, []);
    await this.options.state.repositoryActivities.deleteByRepository(repository.name);
    await this.options.state.repositorySecrets.deleteByRepository(repository.name);
    await this.options.state.publishSessions.deleteByRepository(repository.name);

    for (const token of await this.options.state.publishTokens.list()) {
      // Tokens persisted before signing key scopes existed have no
      // signingKeyIds, which PublishTokenService already tolerates.
      const tokenSigningKeyIds = token.signingKeyIds ?? [];
      if (!token.repositories.includes(repository.name) && !tokenSigningKeyIds.some((id) => repositorySecretIds.has(id))) {
        continue;
      }
      const repositories = token.repositories.filter((candidate) => candidate !== repository.name);
      const signingKeyIds = tokenSigningKeyIds.filter((id) => !repositorySecretIds.has(id));
      await this.options.state.publishTokens.save({
        ...token,
        repositories,
        signingKeyIds,
        ...(repositories.length === 0 && !token.revokedAt ? { revokedAt: now } : {}),
      });
    }

    await this.options.state.repositories.deleteByName(repository.name);
  }
}
