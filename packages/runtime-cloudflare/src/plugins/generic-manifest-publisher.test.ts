import type { PublishArtifactsInput, RepositoryObjectStore } from "@axis-repository/core";
import { describe, expect, it } from "vitest";
import { GenericManifestPublisher } from "./generic-manifest-publisher";
import { JSON_CONTENT_TYPE, MemoryRepositoryObjectStore } from "../storage/repository-object-store";

class FailingPublishObjectStore implements RepositoryObjectStore {
  readonly keys: string[] = [];

  async putJson(key: string): Promise<void> {
    this.keys.push(key);
    if (key.includes("/publishes/")) {
      throw new Error("publish write failed");
    }
  }

  async putText(key: string): Promise<void> {
    this.keys.push(key);
  }

  async putBytes(key: string): Promise<void> {
    this.keys.push(key);
  }

  async copyObject(sourceKey: string, destinationKey: string): Promise<void> {
    this.keys.push(`${sourceKey}->${destinationKey}`);
  }

  async getObject(): Promise<null> {
    return null;
  }

  async headObject(): Promise<null> {
    return null;
  }
}

describe("GenericManifestPublisher", () => {
  it("writes an immutable repository publish manifest", async () => {
    const objectStore = new MemoryRepositoryObjectStore();
    const publisher = new GenericManifestPublisher({
      objectStore,
      now: () => new Date("2026-07-12T00:01:00.000Z"),
    });
    const input: PublishArtifactsInput = {
      repository: {
        id: "repo_1",
        name: "debian-internal",
        ecosystem: "apt",
        visibility: "private",
        config: {},
        createdAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
      },
      session: {
        id: "pub_1",
        repositoryName: "debian-internal",
        ecosystem: "apt",
        status: "finalizing",
        requestedBy: {
          tokenId: "tok_1",
          name: "ci",
          permissions: ["publish"],
          repositories: ["debian-internal"],
          ecosystemScopes: {},
          signingKeyIds: [],
        },
        artifacts: [],
        uploads: [],
        verifiedUploads: [],
        createdAt: "2026-07-12T00:00:00.000Z",
        expiresAt: "2026-07-12T01:00:00.000Z",
        publishStartedAt: "2026-07-12T00:00:45.000Z",
        finalizingStartedAt: "2026-07-12T00:01:00.000Z",
      },
      artifacts: [
        {
          artifact: {
            filename: "myapp_1.2.3_amd64.deb",
            size: 999,
            sha256: "0".repeat(64),
            contentType: "application/vnd.debian.binary-package",
            metadata: { component: "main" },
          },
          upload: {
            uploadId: "upl_1",
            filename: "myapp_1.2.3_amd64.deb",
            objectKey: "_staging/uploads/pub_1/upl_1/myapp_1.2.3_amd64.deb",
            method: "PUT",
            url: "https://uploads.local/pub_1/upl_1",
            headers: {},
            expiresAt: "2026-07-12T00:15:00.000Z",
          },
          verified: {
            uploadId: "upl_1",
            objectKey: "repositories/debian-internal/pool/myapp_1.2.3_amd64.deb",
            size: 1234,
            sha256: "a".repeat(64),
            verifiedAt: "2026-07-12T00:00:30.000Z",
          },
        },
      ],
    };
    const manifest = {
      repository: "debian-internal",
      ecosystem: "apt",
      sessionId: "pub_1",
      publishedAt: "2026-07-12T00:00:45.000Z",
      artifacts: [
        {
          filename: "myapp_1.2.3_amd64.deb",
          contentType: "application/vnd.debian.binary-package",
          size: 1234,
          sha256: "a".repeat(64),
          objectKey: "repositories/debian-internal/pool/myapp_1.2.3_amd64.deb",
          metadata: { component: "main" },
        },
      ],
    };

    await expect(publisher.publish(input)).resolves.toEqual({
      publishedAt: "2026-07-12T00:00:45.000Z",
      objects: [
        {
          key: "repositories/debian-internal/publishes/pub_1.json",
          contentType: JSON_CONTENT_TYPE,
        },
      ],
    });
    expect(objectStore.objects).toEqual([
      {
        key: "repositories/debian-internal/publishes/pub_1.json",
        value: manifest,
      },
    ]);
  });

  it("surfaces immutable publish manifest write failures", async () => {
    const objectStore = new FailingPublishObjectStore();
    const publisher = new GenericManifestPublisher({ objectStore });
    const input: PublishArtifactsInput = {
      repository: {
        id: "repo_1",
        name: "debian-internal",
        ecosystem: "apt",
        visibility: "private",
        config: {},
        createdAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
      },
      session: {
        id: "pub_1",
        repositoryName: "debian-internal",
        ecosystem: "apt",
        status: "finalizing",
        requestedBy: {
          tokenId: "tok_1",
          name: "ci",
          permissions: ["publish"],
          repositories: ["debian-internal"],
          ecosystemScopes: {},
          signingKeyIds: [],
        },
        artifacts: [],
        uploads: [],
        verifiedUploads: [],
        createdAt: "2026-07-12T00:00:00.000Z",
        expiresAt: "2026-07-12T01:00:00.000Z",
      },
      artifacts: [],
    };

    await expect(publisher.publish(input)).rejects.toThrow("publish write failed");
    expect(objectStore.keys).toEqual(["repositories/debian-internal/publishes/pub_1.json"]);
  });

  it("uses the stable publish start time across retry leases", async () => {
    const objectStore = new MemoryRepositoryObjectStore();
    const publisher = new GenericManifestPublisher({
      objectStore,
      now: () => new Date("2026-07-12T00:05:00.000Z"),
    });
    const baseInput: PublishArtifactsInput = {
      repository: {
        id: "repo_1",
        name: "debian-internal",
        ecosystem: "apt",
        visibility: "private",
        config: {},
        createdAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
      },
      session: {
        id: "pub_1",
        repositoryName: "debian-internal",
        ecosystem: "apt",
        status: "finalizing",
        requestedBy: {
          tokenId: "tok_1",
          name: "ci",
          permissions: ["publish"],
          repositories: ["debian-internal"],
          ecosystemScopes: {},
          signingKeyIds: [],
        },
        artifacts: [],
        uploads: [],
        verifiedUploads: [],
        createdAt: "2026-07-12T00:00:00.000Z",
        expiresAt: "2026-07-12T01:00:00.000Z",
        publishStartedAt: "2026-07-12T00:00:30.000Z",
        finalizingStartedAt: "2026-07-12T00:01:00.000Z",
      },
      artifacts: [],
    };

    const first = await publisher.publish(baseInput);
    const second = await publisher.publish({
      ...baseInput,
      session: {
        ...baseInput.session,
        finalizingStartedAt: "2026-07-12T00:03:00.000Z",
      },
    });

    expect(first).toEqual(second);
    expect(objectStore.objects).toEqual([
      {
        key: "repositories/debian-internal/publishes/pub_1.json",
        value: {
          repository: "debian-internal",
          ecosystem: "apt",
          sessionId: "pub_1",
          publishedAt: "2026-07-12T00:00:30.000Z",
          artifacts: [],
        },
      },
      {
        key: "repositories/debian-internal/publishes/pub_1.json",
        value: {
          repository: "debian-internal",
          ecosystem: "apt",
          sessionId: "pub_1",
          publishedAt: "2026-07-12T00:00:30.000Z",
          artifacts: [],
        },
      },
    ]);
  });
});
