import type { ProxyOperationalPolicy, Repository, RepositoryObjectStore } from "@axis-repository/core";
import { RepositoryRuntimePluginRegistry } from "./repository-runtime-plugin-registry";
import { OpenPgpSigner } from "../signing/openpgp-signer";
import { createBundledRuntimePlugins } from "./bundled-runtime-plugins";
import { repositoryScopedObjectStoreFactory } from "./scoped-capabilities";
import type { RepositorySecretService } from "../storage/repository-secret-service";

export function createDefaultArtifactPlugins(input: {
  objectStore: RepositoryObjectStore;
  secrets: RepositorySecretService;
  proxyPolicyFor?: (repository: Repository) => Promise<ProxyOperationalPolicy> | ProxyOperationalPolicy;
}): RepositoryRuntimePluginRegistry {
  const registry = new RepositoryRuntimePluginRegistry();
  for (const plugin of createBundledRuntimePlugins({
    // Publishers get a store confined to the repository they are publishing to.
    objectStoreFor: repositoryScopedObjectStoreFactory(input.objectStore),
    secrets: input.secrets,
    aptReleaseSigner: new OpenPgpSigner(),
    ...(input.proxyPolicyFor === undefined ? {} : { proxyPolicyFor: input.proxyPolicyFor }),
  })) {
    registry.register(plugin);
  }
  return registry;
}
