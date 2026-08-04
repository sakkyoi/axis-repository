import type { RepositoryPluginManifest } from "@axis-repository/core/plugin-manifests";
import type { HostedRepositoryPlugin } from "./plugins/repository-plugin-contract";

export { OpenPgpSigner } from "./signing/openpgp-signer";
export { MemoryRepositoryObjectStore } from "./storage/repository-object-store";
export { SecretEncryption } from "./storage/secret-encryption";
export { RepositorySecretService } from "./storage/repository-secret-service";

function assertJsonEqual(label: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} does not match the shared plugin manifest`);
  }
}

export function assertRuntimePluginManifestParity(input: {
  manifest: RepositoryPluginManifest;
  plugin: HostedRepositoryPlugin;
}): void {
  const { manifest, plugin } = input;
  if (plugin.ecosystem !== manifest.ecosystem) {
    throw new Error(`Runtime plugin ecosystem does not match manifest: ${plugin.ecosystem}`);
  }
  if (plugin.name !== manifest.runtimeName) {
    throw new Error(`Runtime plugin name does not match manifest runtimeName: ${plugin.name}`);
  }
  if (plugin.version !== manifest.version) {
    throw new Error(`Runtime plugin version does not match manifest: ${plugin.version}`);
  }
  if (!(manifest.repositoryKinds ?? ["hosted"]).includes(plugin.kind)) {
    throw new Error(`Runtime plugin kind does not match manifest repository kinds: ${plugin.kind}`);
  }
  assertJsonEqual("Runtime plugin capabilities", plugin.capabilities, manifest.capabilities);
  assertJsonEqual(
    "Runtime plugin client helpers",
    plugin.clientHelpers
      ? {
          namespace: plugin.clientHelpers.namespace,
          actions: plugin.clientHelpers.actions.map(({ handle: _handle, ...action }) => action),
        }
      : undefined,
    manifest.clientHelpers,
  );
  assertJsonEqual(
    "Runtime plugin admin resources",
    plugin.adminResources
      ? {
          namespace: plugin.adminResources.namespace,
          routes: plugin.adminResources.routes.map(({ handle: _handle, ...route }) => route),
        }
      : undefined,
    manifest.adminResources,
  );
}
