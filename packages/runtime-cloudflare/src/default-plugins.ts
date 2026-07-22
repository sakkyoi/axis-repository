import type { RepositoryObjectStore } from "@axis-repository/core";
import { createAptPlugin } from "./apt-plugin";
import { AptPublisher } from "./apt-publisher";
import { ArtifactPublisherRegistry } from "./artifact-publisher-registry";
import { OpenPgpSigner } from "./openpgp-signer";
import { createPypiPlugin } from "./pypi-plugin";
import type { SigningKeyService } from "./signing-key-service";

export function createDefaultArtifactPlugins(input: {
  objectStore: RepositoryObjectStore;
  signingKeyService: SigningKeyService;
}): ArtifactPublisherRegistry {
  const registry = new ArtifactPublisherRegistry();
  registry.register(createAptPlugin({
    publisher: new AptPublisher({
      objectStore: input.objectStore,
      signingKeyService: input.signingKeyService,
      signer: new OpenPgpSigner(),
    }),
  }));
  registry.register(createPypiPlugin({ objectStore: input.objectStore }));
  return registry;
}
