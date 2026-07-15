import { describe, expect, it } from "vitest";
import {
  JSON_CONTENT_TYPE,
  MemoryRepositoryObjectStore,
  R2RepositoryObjectStore,
  type R2JsonBucket,
} from "./repository-object-store";

class FakeR2Bucket implements R2JsonBucket {
  readonly puts: Array<{
    key: string;
    value: string;
    options?: { httpMetadata?: { contentType?: string } };
  }> = [];

  async put(key: string, value: string, options?: { httpMetadata?: { contentType?: string } }) {
    this.puts.push(options === undefined ? { key, value } : { key, value, options });
  }
}

describe("MemoryRepositoryObjectStore", () => {
  it("captures JSON objects by key", async () => {
    const store = new MemoryRepositoryObjectStore();
    const value = { repository: "debian-internal" };

    await store.putJson("repositories/debian-internal/latest.json", value);

    expect(store.objects).toEqual([
      {
        key: "repositories/debian-internal/latest.json",
        value,
      },
    ]);
  });
});

describe("R2RepositoryObjectStore", () => {
  it("writes JSON with content metadata", async () => {
    const bucket = new FakeR2Bucket();
    const store = new R2RepositoryObjectStore(bucket);

    await store.putJson("repositories/debian-internal/latest.json", { repository: "debian-internal" });

    expect(bucket.puts).toEqual([
      {
        key: "repositories/debian-internal/latest.json",
        value: JSON.stringify({ repository: "debian-internal" }),
        options: {
          httpMetadata: {
            contentType: JSON_CONTENT_TYPE,
          },
        },
      },
    ]);
  });
});
