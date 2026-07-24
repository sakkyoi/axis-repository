import type { RepositoryObjectStore } from "@axis-repository/core";
import { RepositoryRuntimePluginRegistry } from "./repository-runtime-plugin-registry";
import { OpenPgpSigner } from "./openpgp-signer";
import { createBundledRuntimePlugins } from "./bundled-runtime-plugins";
import type { RepositorySecretService } from "./repository-secret-service";

export function createDefaultArtifactPlugins(input: {
  objectStore: RepositoryObjectStore;
  secrets: RepositorySecretService;
}): RepositoryRuntimePluginRegistry {
  const registry = new RepositoryRuntimePluginRegistry();
  for (const plugin of createBundledRuntimePlugins({
    objectStore: input.objectStore,
    secrets: input.secrets,
    aptReleaseSigner: new OpenPgpSigner(),
  })) {
    registry.register(plugin);
  }
  return registry;
}
