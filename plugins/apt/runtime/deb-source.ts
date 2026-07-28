import { ValidationError, type RepositoryObjectStore } from "@axis-repository/core";
import { objectBytes, objectStream } from "@axis-repository/runtime-cloudflare/plugin-runtime";
import type { DebArchiveSource } from "../shared/deb-archive";
import type { ByteChunk } from "@axis-repository/core/archives";

/**
 * Opens an uploaded `.deb` for reading in place.
 *
 * The size comes from a HEAD rather than the session record, so the ranges
 * asked for are bounded by what the store actually holds.
 */
export async function openUploadedDebArchive(
  objectStore: RepositoryObjectStore,
  key: string,
): Promise<DebArchiveSource> {
  const metadata = await objectStore.headObject(key);
  if (!metadata || metadata.contentLength === undefined) {
    throw new ValidationError("APT artifact upload object could not be read for metadata parsing");
  }
  return debArchiveSourceForObject({ objectStore, key, size: metadata.contentLength });
}

/**
 * Reads a stored `.deb` in place, rather than downloading it.
 *
 * Publishing needs two things out of an upload: the control fields, which sit
 * in a member of a few kilobytes, and the names in the data archive, which are
 * spread through it but tiny in total. An upload may be gigabytes and a worker
 * has 128 MB of heap, so both come from ranged reads over the stored object
 * and the data archive is walked as a stream.
 */
export function debArchiveSourceForObject(input: {
  objectStore: RepositoryObjectStore;
  key: string;
  size: number;
}): DebArchiveSource {
  const { objectStore, key, size } = input;

  const rangeOf = (offset: number, length: number) => ({
    offset,
    length: Math.max(Math.min(length, size - offset), 0),
  });

  return {
    size,

    async read(offset, length) {
      const object = await objectStore.getObject(key, { range: rangeOf(offset, length) });
      if (!object) {
        throw new Error(`APT artifact upload object disappeared while being read: ${key}`);
      }
      return objectBytes(object);
    },

    stream(offset, length) {
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

      // Reading on `pull` rather than `start` keeps the range under
      // backpressure: the tar walker is handed one chunk when it asks for one,
      // instead of the whole member piling up in this stream's queue.
      return new ReadableStream<ByteChunk>({
        async pull(controller) {
          if (!reader) {
            const object = await objectStore.getObject(key, { range: rangeOf(offset, length) });
            if (!object) {
              throw new Error(`APT artifact upload object disappeared while being read: ${key}`);
            }
            reader = objectStream(object).getReader();
          }
          const next = await reader.read();
          if (next.done) {
            controller.close();
            return;
          }
          controller.enqueue(next.value as ByteChunk);
        },
        async cancel(reason) {
          await reader?.cancel(reason);
        },
      });
    },
  };
}
