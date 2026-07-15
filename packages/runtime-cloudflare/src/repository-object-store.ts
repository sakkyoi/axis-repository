import type { RepositoryObjectStore } from "@axis-repository/core";

export const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

export interface R2JsonBucket {
  put(
    key: string,
    value: string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
}

export class MemoryRepositoryObjectStore implements RepositoryObjectStore {
  readonly objects: Array<{ key: string; value: unknown }> = [];

  async putJson(key: string, value: unknown): Promise<void> {
    this.objects.push({ key, value: JSON.parse(JSON.stringify(value)) });
  }
}

export class R2RepositoryObjectStore implements RepositoryObjectStore {
  constructor(private readonly bucket: R2JsonBucket) {}

  async putJson(key: string, value: unknown): Promise<void> {
    await this.bucket.put(key, JSON.stringify(value), {
      httpMetadata: { contentType: JSON_CONTENT_TYPE },
    });
  }
}
