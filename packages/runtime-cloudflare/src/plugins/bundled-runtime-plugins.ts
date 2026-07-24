import type { RepositoryObjectStore } from "@axis-repository/core";
import type {
  ArtifactRepositoryPlugin,
  RepositorySecretCapability,
} from "@axis-repository/runtime-cloudflare/plugin-runtime";
import { bundledRepositoryPlugins } from "../../../../plugins/bundled";
import { AptPublisher } from "../../../../plugins/apt/runtime/publisher";
import { createAptPlugin } from "../../../../plugins/apt/runtime/runtime";
import { AptSigningKeyResource } from "../../../../plugins/apt/runtime/signing-keys";
import { createPypiPlugin } from "../../../../plugins/pypi/runtime/runtime";

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

export interface BundledRuntimePluginInput {
  objectStore: RepositoryObjectStore;
  secrets: RepositorySecretCapability;
  aptReleaseSigner: AptReleaseSigner;
}

type RuntimePluginFactory = (input: BundledRuntimePluginInput) => ArtifactRepositoryPlugin;

const bundledRuntimePluginFactories: Record<string, RuntimePluginFactory> = {
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

export function createBundledRuntimePlugins(input: BundledRuntimePluginInput): ArtifactRepositoryPlugin[] {
  return bundledRepositoryPlugins
    .filter((plugin) => plugin.catalog.enabled && plugin.runtime)
    .map((plugin) => {
      const factory = bundledRuntimePluginFactories[plugin.manifest.ecosystem];
      if (!factory) {
        throw new Error(`Runtime plugin is not wired for ecosystem: ${plugin.manifest.ecosystem}`);
      }
      return factory(input);
    });
}
