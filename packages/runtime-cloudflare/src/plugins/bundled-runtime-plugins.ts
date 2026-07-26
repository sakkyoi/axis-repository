
import type {
  ArtifactRepositoryPlugin,
  RepositorySecretCapability,
} from "@axis-repository/runtime-cloudflare/plugin-runtime";
import { aptRepositoryPluginBundle } from "@axis-repository/plugin-apt";
import { AptPublisher } from "@axis-repository/plugin-apt/runtime/publisher";
import { createAptPlugin, AptSigningKeyResource } from "@axis-repository/plugin-apt/runtime";
import { pypiRepositoryPluginBundle } from "@axis-repository/plugin-pypi";
import { createPypiPlugin } from "@axis-repository/plugin-pypi/runtime";
import { scopeSecretsToEcosystem, type RepositoryObjectStoreFactory } from "./scoped-capabilities";

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
  /** Repository-scoped stores, resolved per publish rather than shared. */
  objectStoreFor: RepositoryObjectStoreFactory;
  secrets: RepositorySecretCapability;
  aptReleaseSigner: AptReleaseSigner;
}

type RuntimePluginFactory = (input: BundledRuntimePluginInput) => ArtifactRepositoryPlugin;

const bundledRuntimePluginFactories: Record<string, RuntimePluginFactory> = {
  apt: (input) => {
    const signingKeys = new AptSigningKeyResource({ secrets: input.secrets });
    return createAptPlugin({
      publisher: new AptPublisher({
        objectStoreFor: input.objectStoreFor,
        signingKeys,
        signer: input.aptReleaseSigner,
      }),
      signingKeys,
    });
  },
  pypi: (input) => createPypiPlugin({ objectStoreFor: input.objectStoreFor }),
};

export function createBundledRuntimePlugins(input: BundledRuntimePluginInput): ArtifactRepositoryPlugin[] {
  return [aptRepositoryPluginBundle, pypiRepositoryPluginBundle]
    .filter((plugin) => plugin.catalog.enabled && plugin.runtime)
    .map((plugin) => {
      const ecosystem = plugin.manifest.ecosystem;
      const factory = bundledRuntimePluginFactories[ecosystem];
      if (!factory) {
        throw new Error(`Runtime plugin is not wired for ecosystem: ${ecosystem}`);
      }
      // Each plugin only ever sees the secret namespaces it owns.
      return factory({ ...input, secrets: scopeSecretsToEcosystem(input.secrets, ecosystem) });
    });
}
