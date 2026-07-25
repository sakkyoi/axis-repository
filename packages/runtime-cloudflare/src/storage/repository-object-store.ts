import type {
  RepositoryObjectList,
  RepositoryObject,
  RepositoryObjectMetadata,
  RepositoryObjectReadOptions,
  RepositoryObjectStore,
} from "@axis-repository/core";

export const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

export interface R2ReadableObject {
  httpMetadata?: { contentType?: string };
  etag?: string;
  httpEtag?: string;
  size?: number;
  body?: ReadableStream;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface R2HeadObject {
  httpMetadata?: { contentType?: string };
  etag?: string;
  httpEtag?: string;
  size?: number;
}

export interface R2ObjectBucket {
  head(key: string): Promise<R2HeadObject | null>;
  get(key: string, options?: RepositoryObjectReadOptions): Promise<R2ReadableObject | null>;
  list(options?: { prefix?: string; delimiter?: string; cursor?: string; limit?: number }): Promise<R2ObjectsList>;
  delete(key: string): Promise<unknown>;
  put(
    key: string,
    value: string | Uint8Array | ReadableStream,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
}

export interface R2ListedObject {
  key: string;
  httpMetadata?: { contentType?: string };
  httpEtag?: string;
  size?: number;
}

export interface R2ObjectsList {
  objects: R2ListedObject[];
  delimitedPrefixes: string[];
  cursor?: string;
  truncated: boolean;
}

export class MemoryRepositoryObjectStore implements RepositoryObjectStore {
  readonly objects: Array<{ key: string; value: unknown; contentType?: string }> = [];

  async putJson(key: string, value: unknown): Promise<void> {
    this.objects.push({ key, value: JSON.parse(JSON.stringify(value)) });
  }

  async putText(key: string, value: string, contentType: string): Promise<void> {
    this.objects.push({ key, value, contentType });
  }

  async putBytes(key: string, value: Uint8Array, contentType: string): Promise<void> {
    this.objects.push({ key, value: new Uint8Array(value), contentType });
  }

  async copyObject(
    sourceKey: string,
    destinationKey: string,
    contentType?: string,
  ): Promise<void> {
    const source = [...this.objects].reverse().find((object) => object.key === sourceKey);
    if (!source) {
      throw new Error(`Object not found: ${sourceKey}`);
    }

    this.objects.push({
      key: destinationKey,
      value: cloneObjectValue(source.value),
      ...(contentType ?? source.contentType
        ? { contentType: contentType ?? source.contentType }
      : {}),
    });
  }

  async getObject(
    key: string,
    options?: RepositoryObjectReadOptions,
  ): Promise<RepositoryObject | null> {
    const source = [...this.objects].reverse().find((object) => object.key === key);
    if (!source) {
      return null;
    }

    const metadata = await memoryObjectMetadata(source.value, source.contentType);
    const fullObject = memoryObjectValue(source.value, source.contentType);
    const bytes = bytesFromBody(fullObject.body);
    const rangedBody = options?.range
      ? bodyFromBytes(bytes.slice(options.range.offset, options.range.offset + options.range.length), fullObject.body)
      : cloneObjectValue(fullObject.body) as string | Uint8Array;

    return {
      body: rangedBody,
      ...metadata,
      ...(options?.range ? { range: options.range } : {}),
    };
  }

  async headObject(key: string): Promise<RepositoryObjectMetadata | null> {
    const source = [...this.objects].reverse().find((object) => object.key === key);
    if (!source) {
      return null;
    }
    return memoryObjectMetadata(source.value, source.contentType);
  }

  async listObjects(input: { prefix: string; delimiter?: string; cursor?: string; limit?: number }): Promise<RepositoryObjectList> {
    const latestObjects = latestMemoryObjects(this.objects)
      .filter((object) => object.key.startsWith(input.prefix))
      .sort((left, right) => left.key.localeCompare(right.key));
    const directories = new Set<string>();
    const objects: RepositoryObjectList["objects"] = [];

    for (const object of latestObjects) {
      const rest = object.key.slice(input.prefix.length);
      const delimiterIndex = input.delimiter ? rest.indexOf(input.delimiter) : -1;
      if (input.delimiter && delimiterIndex >= 0) {
        directories.add(`${input.prefix}${rest.slice(0, delimiterIndex + input.delimiter.length)}`);
        continue;
      }
      objects.push({
        key: object.key,
        ...await memoryObjectMetadata(object.value, object.contentType),
      });
    }

    return {
      prefix: input.prefix,
      directories: [...directories].sort((left, right) => left.localeCompare(right)).map((path) => ({ path })),
      objects,
      truncated: false,
    };
  }

  async deleteObject(key: string): Promise<boolean> {
    const previousLength = this.objects.length;
    for (let index = this.objects.length - 1; index >= 0; index -= 1) {
      if (this.objects[index]?.key === key) {
        this.objects.splice(index, 1);
      }
    }
    return previousLength !== this.objects.length;
  }
}

export class R2RepositoryObjectStore implements RepositoryObjectStore {
  constructor(private readonly bucket: R2ObjectBucket) {}

  async putJson(key: string, value: unknown): Promise<void> {
    await this.bucket.put(key, JSON.stringify(value), {
      httpMetadata: { contentType: JSON_CONTENT_TYPE },
    });
  }

  async putText(key: string, value: string, contentType: string): Promise<void> {
    await this.bucket.put(key, value, {
      httpMetadata: { contentType },
    });
  }

  async putBytes(key: string, value: Uint8Array, contentType: string): Promise<void> {
    await this.bucket.put(key, new Uint8Array(value), {
      httpMetadata: { contentType },
    });
  }

  async copyObject(
    sourceKey: string,
    destinationKey: string,
    contentType?: string,
  ): Promise<void> {
    const source = await this.bucket.get(sourceKey);
    if (!source) {
      throw new Error(`Object not found: ${sourceKey}`);
    }

    const copiedContentType = contentType ?? source.httpMetadata?.contentType;
    const value = source.body ?? new Uint8Array(await source.arrayBuffer());
    await this.bucket.put(destinationKey, value, {
      ...(copiedContentType !== undefined ? { httpMetadata: { contentType: copiedContentType } } : {}),
    });
  }

  async getObject(
    key: string,
    options?: RepositoryObjectReadOptions,
  ): Promise<RepositoryObject | null> {
    const source = await this.bucket.get(key, options);
    if (!source) {
      return null;
    }
    return {
      body: source.body ?? new Uint8Array(await source.arrayBuffer()),
      ...(source.httpMetadata?.contentType !== undefined
        ? { contentType: source.httpMetadata.contentType }
        : {}),
      ...(source.size !== undefined ? { contentLength: source.size } : {}),
      ...(source.httpEtag !== undefined ? { etag: source.httpEtag } : {}),
      ...(options?.range ? { range: options.range } : {}),
    };
  }

  async headObject(key: string): Promise<RepositoryObjectMetadata | null> {
    const source = await this.bucket.head(key);
    if (!source) {
      return null;
    }
    return {
      ...(source.httpMetadata?.contentType !== undefined
        ? { contentType: source.httpMetadata.contentType }
        : {}),
      ...(source.size !== undefined ? { contentLength: source.size } : {}),
      ...(source.httpEtag !== undefined ? { etag: source.httpEtag } : {}),
    };
  }

  async listObjects(input: { prefix: string; delimiter?: string; cursor?: string; limit?: number }): Promise<RepositoryObjectList> {
    const result = await this.bucket.list({
      prefix: input.prefix,
      ...(input.delimiter !== undefined ? { delimiter: input.delimiter } : {}),
      ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
      ...(input.limit !== undefined ? { limit: input.limit } : {}),
    });
    return {
      prefix: input.prefix,
      directories: result.delimitedPrefixes
        .map((path) => ({ path }))
        .sort((left, right) => left.path.localeCompare(right.path)),
      objects: result.objects
        .map((object) => ({
          key: object.key,
          ...(object.httpMetadata?.contentType !== undefined ? { contentType: object.httpMetadata.contentType } : {}),
          ...(object.size !== undefined ? { contentLength: object.size } : {}),
          ...(object.httpEtag !== undefined ? { etag: object.httpEtag } : {}),
        }))
        .sort((left, right) => left.key.localeCompare(right.key)),
      ...(result.cursor !== undefined ? { cursor: result.cursor } : {}),
      truncated: result.truncated,
    };
  }

  async deleteObject(key: string): Promise<boolean> {
    const existing = await this.bucket.head(key);
    if (!existing) {
      return false;
    }
    await this.bucket.delete(key);
    return true;
  }
}

function latestMemoryObjects(objects: Array<{ key: string; value: unknown; contentType?: string }>): Array<{ key: string; value: unknown; contentType?: string }> {
  const byKey = new Map<string, { key: string; value: unknown; contentType?: string }>();
  for (const object of objects) {
    byKey.set(object.key, object);
  }
  return [...byKey.values()];
}

function cloneObjectValue(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return new Uint8Array(value);
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function memoryObjectValue(
  value: unknown,
  contentType: string | undefined,
): { body: string | Uint8Array; contentType: string } {
  if (contentType === undefined && typeof value !== "string" && !(value instanceof Uint8Array)) {
    return {
      body: JSON.stringify(value),
      contentType: JSON_CONTENT_TYPE,
    };
  }
  return {
    body: cloneObjectValue(value) as string | Uint8Array,
    contentType: contentType ?? "application/octet-stream",
  };
}

async function memoryObjectMetadata(
  value: unknown,
  contentType: string | undefined,
): Promise<RepositoryObjectMetadata> {
  const fullObject = memoryObjectValue(value, contentType);
  const bytes = bytesFromBody(fullObject.body);
  return {
    contentType: fullObject.contentType,
    contentLength: bytes.byteLength,
    etag: await etagForBytes(bytes),
  };
}

function bytesFromBody(body: string | Uint8Array): Uint8Array {
  if (typeof body === "string") {
    return new TextEncoder().encode(body);
  }
  return new Uint8Array(body);
}

function bodyFromBytes(bytes: Uint8Array, sourceBody: string | Uint8Array): string | Uint8Array {
  if (typeof sourceBody === "string") {
    return new TextDecoder().decode(bytes);
  }
  return bytes;
}

async function etagForBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `"${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}"`;
}
