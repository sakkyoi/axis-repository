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
  const reader = object.body.getReader();
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
