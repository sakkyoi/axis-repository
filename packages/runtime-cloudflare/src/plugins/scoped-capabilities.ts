import {
  NotFoundError,
  ValidationError,
  type RepositoryObject,
  type RepositoryObjectList,
  type RepositoryObjectMetadata,
  type RepositoryObjectReadOptions,
  type RepositoryObjectStore,
} from "@axis-repository/core";
import type {
  RepositoryActiveSecret,
  RepositorySecretCapability,
  RepositorySecretRecord,
} from "./repository-plugin-capabilities";


/**
 * A plugin owns the secret namespaces named after its ecosystem: `apt` itself,
 * and anything below it such as `apt.signing-key`.
 */
export function ownsSecretNamespace(ecosystem: string, namespace: string): boolean {
  return namespace === ecosystem || namespace.startsWith(`${ecosystem}.`);
}

/**
 * Binds a secret capability to one plugin's namespaces.
 *
 * The underlying service addresses secrets by bare id, so without this any
 * plugin could enumerate `apt.signing-key` and decrypt another plugin's private
 * keys. Scoping here makes that structural instead of relying on each plugin to
 * check its own namespace.
 */
export function scopeSecretsToEcosystem(
  secrets: RepositorySecretCapability,
  ecosystem: string,
): RepositorySecretCapability {
  const requireOwnedNamespace = (namespace: string): string => {
    if (!ownsSecretNamespace(ecosystem, namespace)) {
      throw new ValidationError(
        `Repository plugin ${ecosystem} cannot access secret namespace: ${namespace}`,
      );
    }
    return namespace;
  };
  const requireOwnedRecord = <T extends { namespace: string }>(record: T): T => {
    if (!ownsSecretNamespace(ecosystem, record.namespace)) {
      throw new NotFoundError();
    }
    return record;
  };

  return {
    createSecretValue: (prefix) => secrets.createSecretValue(prefix),
    create: async (input) => secrets.create({ ...input, namespace: requireOwnedNamespace(input.namespace) }),
    list: async (input) => secrets.list({ ...input, namespace: requireOwnedNamespace(input.namespace) }),
    get: async (id): Promise<RepositorySecretRecord> => requireOwnedRecord(await secrets.get(id)),
    getActive: async (id): Promise<RepositoryActiveSecret> => requireOwnedRecord(await secrets.getActive(id)),
    revoke: async (id): Promise<RepositorySecretRecord> => {
      // Check ownership before mutating, so a foreign id is never revoked.
      requireOwnedRecord(await secrets.get(id));
      return secrets.revoke(id);
    },
  };
}

/**
 * Restricts an object store to one repository's key space.
 *
 * Writes must land under `repositories/<name>/`. Reads additionally allow that
 * repository's own staging area, because publishers copy verified uploads out
 * of it — but not anyone else's, which would expose every in-flight upload in
 * the deployment.
 */
export function scopeObjectStoreToRepository(
  objectStore: RepositoryObjectStore,
  repositoryName: string,
): RepositoryObjectStore {
  const repositoryPrefix = `repositories/${repositoryName}/`;
  const stagingPrefix = `_staging/uploads/${repositoryName}/`;
  const isWithinRepository = (key: string): boolean => key.startsWith(repositoryPrefix);

  const requireWritable = (key: string): string => {
    if (!isWithinRepository(key)) {
      throw new ValidationError(`Object key is outside repository ${repositoryName}: ${key}`);
    }
    return key;
  };
  const requireReadable = (key: string): string => {
    if (!isWithinRepository(key) && !key.startsWith(stagingPrefix)) {
      throw new ValidationError(`Object key is outside repository ${repositoryName}: ${key}`);
    }
    return key;
  };

  // Every method is async so a rejected key surfaces as a rejected promise
  // rather than a synchronous throw from a promise-returning call.
  return {
    putJson: async (key, value) => objectStore.putJson(requireWritable(key), value),
    putText: async (key, value, contentType) => objectStore.putText(requireWritable(key), value, contentType),
    putBytes: async (key, value, contentType) => objectStore.putBytes(requireWritable(key), value, contentType),
    createPartWriter: async (key, contentType) =>
      objectStore.createPartWriter(requireWritable(key), contentType),
    copyObject: async (sourceKey, destinationKey, contentType) =>
      objectStore.copyObject(requireReadable(sourceKey), requireWritable(destinationKey), contentType),
    getObject: async (key, options?: RepositoryObjectReadOptions): Promise<RepositoryObject | null> =>
      objectStore.getObject(requireReadable(key), options),
    headObject: async (key): Promise<RepositoryObjectMetadata | null> =>
      objectStore.headObject(requireReadable(key)),
    listObjects: async (input): Promise<RepositoryObjectList> =>
      objectStore.listObjects({ ...input, prefix: requireReadable(input.prefix) }),
    deleteObject: async (key) => objectStore.deleteObject(requireWritable(key)),
  };
}

/** Resolves a repository-scoped object store on demand. */
export type RepositoryObjectStoreFactory = (repositoryName: string) => RepositoryObjectStore;

export function repositoryScopedObjectStoreFactory(
  objectStore: RepositoryObjectStore,
): RepositoryObjectStoreFactory {
  return (repositoryName) => scopeObjectStoreToRepository(objectStore, repositoryName);
}
