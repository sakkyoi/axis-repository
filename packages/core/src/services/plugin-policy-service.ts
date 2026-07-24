import type { RepositoryPluginPolicyRecord } from "../domain/domain";
import type { StateStore } from "../ports/ports";

export interface PluginPolicyServiceOptions {
  state: StateStore;
}

export class PluginPolicyService {
  constructor(private readonly options: PluginPolicyServiceOptions) {}

  get(ecosystem: string): Promise<RepositoryPluginPolicyRecord | null> {
    return this.options.state.repositoryPluginPolicies.getByEcosystem(ecosystem);
  }

  list(): Promise<RepositoryPluginPolicyRecord[]> {
    return this.options.state.repositoryPluginPolicies.list();
  }

  async setEnabledOverride(
    ecosystem: string,
    enabledOverride: boolean | null,
  ): Promise<RepositoryPluginPolicyRecord> {
    const record: RepositoryPluginPolicyRecord = { ecosystem, enabledOverride };
    await this.options.state.repositoryPluginPolicies.save(record);
    return record;
  }
}
