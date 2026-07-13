import type { Ecosystem, Repository, RepositoryVisibility } from "./domain";
import { NotFoundError, ValidationError } from "./errors";
import type { Clock, RandomId, StateStore } from "./ports";

export interface CreateRepositoryInput {
  name: string;
  ecosystem: Ecosystem;
  visibility?: RepositoryVisibility;
  config?: Record<string, unknown>;
}

export interface RepositoryServiceOptions {
  state: StateStore;
  clock: Clock;
  randomId: RandomId;
}

export class RepositoryService {
  constructor(private readonly options: RepositoryServiceOptions) {}

  async create(input: CreateRepositoryInput): Promise<Repository> {
    const name = input.name.trim();
    if (!name) {
      throw new ValidationError("Repository name is required");
    }
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
}
