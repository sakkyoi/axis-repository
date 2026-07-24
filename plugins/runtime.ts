import type { RepositoryObjectStore } from "@axis-repository/core";
import type {
  ArtifactRepositoryPlugin,
  RepositorySecretCapability,
} from "@axis-repository/runtime-cloudflare/plugin-runtime";
import { repositoryPluginCatalog } from "./catalog";
import { AptPublisher } from "./apt/runtime/publisher";
import { createAptPlugin } from "./apt/runtime/runtime";
import { AptSigningKeyResource } from "./apt/runtime/signing-keys";
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
  secrets: RepositorySecretCapability;
  aptReleaseSigner: AptReleaseSigner;
}

type RuntimePluginFactory = (input: RepositoryRuntimePluginInput) => ArtifactRepositoryPlugin;

const runtimePluginFactories: Record<string, RuntimePluginFactory> = {
  apt: (input) => {
    const signingKeys = new AptSigningKeyResource({ secrets: input.secrets });
    return createAptPlugin({
      publisher: new AptPublisher({
        objectStore: input.objectStore,
        signingKeys,
        signer: input.aptReleaseSigner,
      }),
      signingKeys,
    });
  },
  pypi: (input) => createPypiPlugin({ objectStore: input.objectStore }),
};

export function createRepositoryRuntimePlugins(input: RepositoryRuntimePluginInput): ArtifactRepositoryPlugin[] {
  return repositoryPluginCatalog
    .filter((entry) => entry.enabled && entry.runtime)
    .map((entry) => {
      const factory = runtimePluginFactories[entry.manifest.ecosystem];
      if (!factory) {
        throw new Error(`Runtime plugin is not wired for ecosystem: ${entry.manifest.ecosystem}`);
      }
      return factory(input);
    });
}
