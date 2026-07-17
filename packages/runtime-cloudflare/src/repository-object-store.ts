import type { RepositoryObjectStore } from "@axis-repository/core";

export const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

export interface R2ReadableObject {
  httpMetadata?: { contentType?: string };
  body?: ReadableStream;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface R2JsonBucket {
  get(key: string): Promise<R2ReadableObject | null>;
  put(
    key: string,
    value: string | Uint8Array | ReadableStream,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
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
}

export class R2RepositoryObjectStore implements RepositoryObjectStore {
  constructor(private readonly bucket: R2JsonBucket) {}

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
    await this.bucket.put(key, value, {
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
      ...(copiedContentType ? { httpMetadata: { contentType: copiedContentType } } : {}),
    });
  }
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
