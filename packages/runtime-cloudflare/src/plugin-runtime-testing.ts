import type { RepositoryPluginManifest } from "@axis-repository/core/plugin-manifests";
import type { ArtifactRepositoryPlugin } from "./repository-plugin-contract";

export { OpenPgpSigner } from "./openpgp-signer";
export { MemoryRepositoryObjectStore } from "./repository-object-store";
export { SecretEncryption } from "./secret-encryption";
export { RepositorySecretService } from "./repository-secret-service";

function assertJsonEqual(label: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} does not match the shared plugin manifest`);
  }
}

export function assertRuntimePluginManifestParity(input: {
  manifest: RepositoryPluginManifest;
  plugin: ArtifactRepositoryPlugin;
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
