import type {
  RepositoryObject,
  RepositoryObjectListItem,
  RepositoryObjectStore,
} from "@axis-repository/core";

/**
 * Reads a stored object fully into memory, normalizing the three body shapes a
 * {@link RepositoryObjectStore} can return.
 */
export async function objectBytes(object: RepositoryObject): Promise<Uint8Array> {
  if (object.body instanceof Uint8Array) {
    return object.body;
  }
  if (typeof object.body === "string") {
    return new TextEncoder().encode(object.body);
  }
  const chunks: Uint8Array[] = [];
  const reader = object.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    chunks.push(next.value);
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Reads a stored object as a stream, normalizing the same three body shapes.
 *
 * Preferred over {@link objectBytes} for anything whose size follows what a
 * publisher uploaded, which a worker's 128 MB heap will not always hold.
 */
export function objectStream(object: RepositoryObject): ReadableStream<Uint8Array> {
  if (typeof object.body === "string") {
    return bytesAsStream(new TextEncoder().encode(object.body));
  }
  if (object.body instanceof Uint8Array) {
    return bytesAsStream(object.body);
  }
  return object.body as ReadableStream<Uint8Array>;
}

function bytesAsStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  // Via Blob: constructing the stream directly types its chunks as
  // Uint8Array<ArrayBuffer>, which the DOM and workers-types declarations
  // disagree about.
  return new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer]).stream();
}

/** Pages through a prefix listing until the store stops returning a cursor. */
export async function listAllObjects(
  objectStore: RepositoryObjectStore,
  prefix: string,
): Promise<RepositoryObjectListItem[]> {
  const objects: RepositoryObjectListItem[] = [];
  let cursor: string | undefined;
  do {
    const page = await objectStore.listObjects({
      prefix,
      ...(cursor ? { cursor } : {}),
    });
    objects.push(...page.objects);
    cursor = page.cursor;
  } while (cursor);
  return objects;
}

/** JSON response helper for plugin client helpers and admin resources. */
export function pluginJsonResponse(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init?.headers ?? {}),
    },
  });
}
