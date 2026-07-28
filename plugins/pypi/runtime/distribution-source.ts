import { ValidationError, type RepositoryObjectStore } from "@axis-repository/core";
import type { ByteStream, ZipSource } from "@axis-repository/core/archives";
import { objectBytes, objectStream } from "@axis-repository/runtime-cloudflare/plugin-runtime";
import { readSdistMetadata, readWheelMetadata, type PypiCoreMetadata } from "./metadata";
import type { PypiDistributionFilename } from "./names";

/**
 * Reads a stored distribution's metadata without downloading the distribution.
 *
 * A wheel is a zip, indexed from its end, so its metadata costs a few ranged
 * reads however large the wheel is. An sdist is a gzip stream, which cannot be
 * seeked, so it is walked from the front and abandoned at `PKG-INFO` — which
 * the tools that build sdists write near the beginning.
 */
export async function readDistributionMetadata(input: {
  objectStore: RepositoryObjectStore;
  key: string;
  distribution: PypiDistributionFilename;
}): Promise<PypiCoreMetadata> {
  if (input.distribution.kind === "sdist") {
    const object = await input.objectStore.getObject(input.key);
    if (!object) {
      throw new ValidationError(`PyPI upload could not be read: ${input.key}`);
    }
    return readSdistMetadata(objectStream(object) as ByteStream);
  }

  const head = await input.objectStore.headObject(input.key);
  if (!head || head.contentLength === undefined) {
    throw new ValidationError(`PyPI upload could not be read: ${input.key}`);
  }
  return readWheelMetadata(zipSourceForObject(input.objectStore, input.key, head.contentLength));
}

function zipSourceForObject(
  objectStore: RepositoryObjectStore,
  key: string,
  size: number,
): ZipSource {
  return {
    size,
    async read(offset, length) {
      const range = {
        offset: Math.max(offset, 0),
        length: Math.max(Math.min(length, size - offset), 0),
      };
      const object = await objectStore.getObject(key, { range });
      if (!object) {
        throw new ValidationError(`PyPI upload disappeared while being read: ${key}`);
      }
      return objectBytes(object);
    },
  };
}
