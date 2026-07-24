import type { RepositoryObjectStore } from "@axis-repository/core";
import { ArtifactPublisherRegistry } from "./artifact-publisher-registry";
import { OpenPgpSigner } from "./openpgp-signer";
import { createRepositoryRuntimePlugins } from "../../../plugins/runtime";
import type { SigningKeyService } from "./signing-key-service";

export function createDefaultArtifactPlugins(input: {
  objectStore: RepositoryObjectStore;
  signingKeyService: SigningKeyService;
}): ArtifactPublisherRegistry {
  const registry = new ArtifactPublisherRegistry();
  for (const plugin of createRepositoryRuntimePlugins({
    objectStore: input.objectStore,
    signingKeyService: input.signingKeyService,
    aptReleaseSigner: new OpenPgpSigner(),
  })) {
    registry.register(plugin);
  }
  return registry;
}
