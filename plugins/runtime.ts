import type { RepositoryObjectStore } from "@axis-repository/core";
import type {
  ArtifactRepositoryPlugin,
  SigningKeyService,
} from "@axis-repository/runtime-cloudflare/plugin-runtime";
import { repositoryPluginCatalog } from "./catalog";
import { AptPublisher } from "./apt/runtime/publisher";
import { createAptPlugin } from "./apt/runtime/runtime";
import { createPypiPlugin } from "./pypi/runtime/runtime";

interface AptReleaseSigner {
  clearSign(input: {
    text: string;
    privateKeyArmored: string;
    passphrase: string;
    signingDate: Date;
  }): Promise<string>;
  detachSign(input: {
    text: string;
    privateKeyArmored: string;
    passphrase: string;
    signingDate: Date;
  }): Promise<string>;
}

export interface RepositoryRuntimePluginInput {
  objectStore: RepositoryObjectStore;
  signingKeyService: SigningKeyService;
  aptReleaseSigner: AptReleaseSigner;
}

type RuntimePluginFactory = (input: RepositoryRuntimePluginInput) => ArtifactRepositoryPlugin;

const runtimePluginFactories: Record<string, RuntimePluginFactory> = {
  apt: (input) =>
    createAptPlugin({
      publisher: new AptPublisher({
        objectStore: input.objectStore,
        signingKeyService: input.signingKeyService,
        signer: input.aptReleaseSigner,
      }),
    }),
  pypi: (input) => createPypiPlugin({ objectStore: input.objectStore }),
};

export function createRepositoryRuntimePlugins(input: RepositoryRuntimePluginInput): ArtifactRepositoryPlugin[] {
  return repositoryPluginCatalog
    .filter((entry) => entry.runtime)
    .map((entry) => {
      const factory = runtimePluginFactories[entry.manifest.ecosystem];
      if (!factory) {
        throw new Error(`Runtime plugin is not wired for ecosystem: ${entry.manifest.ecosystem}`);
      }
      return factory(input);
    });
}
