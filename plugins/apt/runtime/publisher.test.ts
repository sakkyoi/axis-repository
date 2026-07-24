import { describe, expect, it } from "vitest";
import { createMessage, generateKey, readCleartextMessage, readKey, readSignature, verify } from "openpgp";
import {
  MemoryStateStore,
  ValidationError,
  type PublishArtifactsInput,
  type RepositoryObjectStore,
} from "@axis-repository/core";
import {
  MemoryRepositoryObjectStore,
  OpenPgpSigner,
  SecretEncryption,
  SigningKeyService,
} from "@axis-repository/runtime-cloudflare/plugin-runtime/testing";
import { AptPublisher } from "./publisher";

async function createSigningKey(state: MemoryStateStore) {
  const key = await generateKey({
    type: "ecc",
    curve: "curve25519Legacy",
    userIDs: [{ name: "Axis Test", email: "axis@example.test" }],
    passphrase: "correct-passphrase",
    date: new Date("2026-07-18T00:00:00.000Z"),
  });
  const service = new SigningKeyService({
    state,
    clock: { now: () => new Date("2026-07-18T00:00:00.000Z") },
    randomId: { create: () => "signing_key_prod" },
    encryption: new SecretEncryption("local-test-secret"),
  });
  await service.create({
    repositoryName: "debian-internal",
    name: "debian-prod",
    privateKeyArmored: key.privateKey,
    passphrase: "correct-passphrase",
  });
  return { service, publicKeyArmored: key.publicKey };
}

class RecordingObjectStore implements RepositoryObjectStore {
  readonly objects: Array<{ key: string; value?: unknown; contentType?: string; sourceKey?: string }> = [];

  async putJson(key: string, value: unknown): Promise<void> {
    this.objects.push({ key, value });
  }

  async putText(key: string, value: string, contentType: string): Promise<void> {
    this.objects.push({ key, value, contentType });
  }

  async putBytes(key: string, value: Uint8Array, contentType: string): Promise<void> {
    this.objects.push({ key, value: new Uint8Array(value), contentType });
  }

  async copyObject(sourceKey: string, key: string, contentType?: string): Promise<void> {
    this.objects.push({
      key,
      sourceKey,
      ...(contentType ? { contentType } : {}),
    });
  }

  async getObject(): Promise<null> {
    return null;
  }

  async headObject(): Promise<null> {
    return null;
  }
}

function publishInput(signingKeyIds = ["signing_key_prod"]): PublishArtifactsInput {
  return {
    repository: {
      id: "repo_1",
      name: "debian-internal",
      ecosystem: "apt",
      visibility: "private",
      config: {
        apt: {
          codename: "noble",
          components: ["main"],
          architectures: ["amd64"],
          signingKeyId: "signing_key_prod",
        },
      },
      createdAt: "2026-07-18T00:00:00.000Z",
      updatedAt: "2026-07-18T00:00:00.000Z",
    },
    session: {
      id: "pub_1",
      repositoryName: "debian-internal",
      ecosystem: "apt",
      status: "finalizing",
      requestedBy: {
        tokenId: "ptok_1",
        name: "ci",
        permissions: ["publish"],
        repositories: ["debian-internal"],
        ecosystemScopes: {},
        signingKeyIds,
      },
      artifacts: [],
      uploads: [],
      verifiedUploads: [],
      createdAt: "2026-07-18T00:00:00.000Z",
      expiresAt: "2026-07-18T01:00:00.000Z",
      publishStartedAt: "2026-07-18T00:10:00.000Z",
    },
    artifacts: [
      {
        artifact: {
          filename: "myapp_1.2.3_amd64.deb",
          size: 1234,
          sha256: "a".repeat(64),
          contentType: "application/vnd.debian.binary-package",
          metadata: {
            package: "myapp",
            version: "1.2.3",
            architecture: "amd64",
            component: "main",
            description: "Example package",
            maintainer: "Release Team <release@example.com>",
          },
        },
        upload: {
          uploadId: "upl_1",
          filename: "myapp_1.2.3_amd64.deb",
          objectKey: "_staging/uploads/pub_1/upl_1/myapp_1.2.3_amd64.deb",
          method: "PUT",
          url: "https://uploads.local",
          headers: {},
          expiresAt: "2026-07-18T00:20:00.000Z",
        },
        verified: {
          uploadId: "upl_1",
          objectKey: "_staging/uploads/pub_1/upl_1/myapp_1.2.3_amd64.deb",
          size: 1234,
          sha256: "a".repeat(64),
          verifiedAt: "2026-07-18T00:05:00.000Z",
        },
      },
    ],
  };
}

describe("AptPublisher", () => {
  it("copies pool objects and writes signed APT metadata", async () => {
    const state = new MemoryStateStore();
    const { service: signingKeyService, publicKeyArmored } = await createSigningKey(state);
    const objectStore = new MemoryRepositoryObjectStore();
    await objectStore.putBytes(
      "_staging/uploads/pub_1/upl_1/myapp_1.2.3_amd64.deb",
      new Uint8Array([1, 2, 3]),
      "application/vnd.debian.binary-package",
    );
    const publisher = new AptPublisher({
      objectStore,
      signingKeys: signingKeyService,
      signer: new OpenPgpSigner(),
    });

    const result = await publisher.publish(publishInput());
    const release = findStoredString(objectStore, "repositories/debian-internal/dists/noble/Release");
    const inRelease = findStoredString(objectStore, "repositories/debian-internal/dists/noble/InRelease");
    const releaseGpg = findStoredString(objectStore, "repositories/debian-internal/dists/noble/Release.gpg");
    const publicKey = await readKey({ armoredKey: publicKeyArmored });

    expect(result.publishedAt).toBe("2026-07-18T00:10:00.000Z");
    expect(result.objects).toEqual([
      {
        key: "repositories/debian-internal/pool/main/myapp/myapp_1.2.3_amd64.deb",
        contentType: "application/vnd.debian.binary-package",
      },
      {
        key: "repositories/debian-internal/dists/noble/main/binary-amd64/Packages",
        contentType: "text/plain; charset=utf-8",
      },
      {
        key: "repositories/debian-internal/dists/noble/main/binary-amd64/Packages.gz",
        contentType: "application/gzip",
      },
      {
        key: "repositories/debian-internal/dists/noble/Release",
        contentType: "text/plain; charset=utf-8",
      },
      {
        key: "repositories/debian-internal/dists/noble/InRelease",
        contentType: "text/plain; charset=utf-8",
      },
      {
        key: "repositories/debian-internal/dists/noble/Release.gpg",
        contentType: "application/pgp-signature",
      },
    ]);
    expect(objectStore.objects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "repositories/debian-internal/pool/main/myapp/myapp_1.2.3_amd64.deb",
        }),
        expect.objectContaining({
          key: "repositories/debian-internal/dists/noble/InRelease",
          value: expect.stringContaining("BEGIN PGP SIGNED MESSAGE"),
        }),
        expect.objectContaining({
          key: "repositories/debian-internal/dists/noble/Release.gpg",
          value: expect.stringContaining("BEGIN PGP SIGNATURE"),
        }),
      ]),
    );
    expect((await readCleartextMessage({ cleartextMessage: inRelease })).getText()).toBe(release);
    const clearVerification = await verify({
      message: await readCleartextMessage({ cleartextMessage: inRelease }),
      verificationKeys: publicKey,
    });
    await expect(clearVerification.signatures[0]!.verified).resolves.toBe(true);
    const detachedVerification = await verify({
      message: await createMessage({ text: release }),
      signature: await readSignature({ armoredSignature: releaseGpg }),
      verificationKeys: publicKey,
    });
    await expect(detachedVerification.signatures[0]!.verified).resolves.toBe(true);
  });

  it("writes every package index generated by APT metadata", async () => {
    const state = new MemoryStateStore();
    const { service: signingKeyService } = await createSigningKey(state);
    const objectStore = new MemoryRepositoryObjectStore();
    const input = publishInput();
    input.repository.config = {
      apt: {
        codename: "noble",
        components: ["main", "contrib"],
        architectures: ["amd64", "arm64"],
        signingKeyId: "signing_key_prod",
      },
    };
    input.artifacts = [
      {
        ...input.artifacts[0]!,
        artifact: {
          ...input.artifacts[0]!.artifact,
          filename: "portable_1.0.0_all.deb",
          metadata: {
            ...input.artifacts[0]!.artifact.metadata,
            package: "portable",
            version: "1.0.0",
            architecture: "all",
          },
        },
      },
      {
        ...input.artifacts[0]!,
        artifact: {
          ...input.artifacts[0]!.artifact,
          filename: "worker_2.0.0_arm64.deb",
          metadata: {
            ...input.artifacts[0]!.artifact.metadata,
            package: "worker",
            version: "2.0.0",
            architecture: "arm64",
          },
        },
        upload: {
          ...input.artifacts[0]!.upload,
          objectKey: "_staging/uploads/pub_1/upl_2/worker_2.0.0_arm64.deb",
        },
        verified: {
          ...input.artifacts[0]!.verified,
          objectKey: "_staging/uploads/pub_1/upl_2/worker_2.0.0_arm64.deb",
          sha256: "b".repeat(64),
        },
      },
      {
        ...input.artifacts[0]!,
        artifact: {
          ...input.artifacts[0]!.artifact,
          filename: "addon_3.0.0_amd64.deb",
          metadata: {
            ...input.artifacts[0]!.artifact.metadata,
            package: "addon",
            version: "3.0.0",
            architecture: "amd64",
            component: "contrib",
          },
        },
        upload: {
          ...input.artifacts[0]!.upload,
          objectKey: "_staging/uploads/pub_1/upl_3/addon_3.0.0_amd64.deb",
        },
        verified: {
          ...input.artifacts[0]!.verified,
          objectKey: "_staging/uploads/pub_1/upl_3/addon_3.0.0_amd64.deb",
          sha256: "c".repeat(64),
        },
      },
    ];
    for (const artifact of input.artifacts) {
      await objectStore.putBytes(artifact.verified.objectKey, new Uint8Array([1, 2, 3]), artifact.artifact.contentType);
    }
    const publisher = new AptPublisher({
      objectStore,
      signingKeys: signingKeyService,
      signer: new OpenPgpSigner(),
    });

    const result = await publisher.publish(input);

    expect(result.objects.map((object) => object.key)).toEqual([
      "repositories/debian-internal/pool/main/portable/portable_1.0.0_all.deb",
      "repositories/debian-internal/pool/main/worker/worker_2.0.0_arm64.deb",
      "repositories/debian-internal/pool/contrib/addon/addon_3.0.0_amd64.deb",
      "repositories/debian-internal/dists/noble/main/binary-amd64/Packages",
      "repositories/debian-internal/dists/noble/main/binary-amd64/Packages.gz",
      "repositories/debian-internal/dists/noble/main/binary-arm64/Packages",
      "repositories/debian-internal/dists/noble/main/binary-arm64/Packages.gz",
      "repositories/debian-internal/dists/noble/contrib/binary-amd64/Packages",
      "repositories/debian-internal/dists/noble/contrib/binary-amd64/Packages.gz",
      "repositories/debian-internal/dists/noble/Release",
      "repositories/debian-internal/dists/noble/InRelease",
      "repositories/debian-internal/dists/noble/Release.gpg",
    ]);
  });

  it("publishes byte-identical signed metadata for the same input and publish timestamp", async () => {
    const state = new MemoryStateStore();
    const { service: signingKeyService } = await createSigningKey(state);
    const firstStore = new MemoryRepositoryObjectStore();
    const secondStore = new MemoryRepositoryObjectStore();
    for (const objectStore of [firstStore, secondStore]) {
      await objectStore.putBytes(
        "_staging/uploads/pub_1/upl_1/myapp_1.2.3_amd64.deb",
        new Uint8Array([1, 2, 3]),
        "application/vnd.debian.binary-package",
      );
    }
    const firstPublisher = new AptPublisher({
      objectStore: firstStore,
      signingKeys: signingKeyService,
      signer: new OpenPgpSigner(),
    });
    const secondPublisher = new AptPublisher({
      objectStore: secondStore,
      signingKeys: signingKeyService,
      signer: new OpenPgpSigner(),
    });

    const firstResult = await firstPublisher.publish(publishInput());
    const secondResult = await secondPublisher.publish(publishInput());

    expect(secondResult).toEqual(firstResult);
    expect(repositoryObjects(secondStore)).toEqual(repositoryObjects(firstStore));
  });

  it("fails closed when the publish token lacks signing key scope", async () => {
    const state = new MemoryStateStore();
    const { service: signingKeyService } = await createSigningKey(state);
    const publisher = new AptPublisher({
      objectStore: new MemoryRepositoryObjectStore(),
      signingKeys: signingKeyService,
      signer: new OpenPgpSigner(),
    });

    await expect(publisher.publish(publishInput([]))).rejects.toBeInstanceOf(ValidationError);
  });

  it("fails closed without writes when the signing key is revoked", async () => {
    const state = new MemoryStateStore();
    const { service: signingKeyService } = await createSigningKey(state);
    await signingKeyService.revoke("signing_key_prod");
    const objectStore = new MemoryRepositoryObjectStore();
    const publisher = new AptPublisher({
      objectStore,
      signingKeys: signingKeyService,
      signer: new OpenPgpSigner(),
    });

    await expect(publisher.publish(publishInput())).rejects.toBeInstanceOf(ValidationError);
    expect(objectStore.objects).toEqual([]);
  });

  it("does not write objects when signing fails", async () => {
    const state = new MemoryStateStore();
    const { service: signingKeyService } = await createSigningKey(state);
    const objectStore = new RecordingObjectStore();
    const publisher = new AptPublisher({
      objectStore,
      signingKeys: signingKeyService,
      signer: {
        clearSign: async () => "-----BEGIN PGP SIGNED MESSAGE-----\n",
        detachSign: async () => {
          throw new Error("signing failed");
        },
      },
    });

    await expect(publisher.publish(publishInput())).rejects.toThrow("signing failed");
    expect(objectStore.objects).toEqual([]);
  });
});

function findStoredString(objectStore: MemoryRepositoryObjectStore, key: string): string {
  const object = objectStore.objects.find((candidate) => candidate.key === key);
  expect(object?.value).toEqual(expect.any(String));
  return object!.value as string;
}

function repositoryObjects(objectStore: MemoryRepositoryObjectStore) {
  return objectStore.objects.filter((object) => object.key.startsWith("repositories/"));
}
