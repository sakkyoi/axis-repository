import type { RepositoryObjectStore } from "@axis-repository/core";
import { RepositoryRuntimePluginRegistry } from "./repository-runtime-plugin-registry";
import { OpenPgpSigner } from "./openpgp-signer";
import { createRepositoryRuntimePlugins } from "../../../plugins/runtime";
import type { SigningKeyService } from "./signing-key-service";

export function createDefaultArtifactPlugins(input: {
  objectStore: RepositoryObjectStore;
  signingKeyService: SigningKeyService;
}): RepositoryRuntimePluginRegistry {
  const registry = new RepositoryRuntimePluginRegistry();
  for (const plugin of createRepositoryRuntimePlugins({
    objectStore: input.objectStore,
    signingKeyService: input.signingKeyService,
    aptReleaseSigner: new OpenPgpSigner(),
  })) {
    registry.register(plugin);
  }
  return registry;
}
