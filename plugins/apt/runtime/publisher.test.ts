import { describe, expect, it } from "vitest";
import { createMessage, generateKey, readCleartextMessage, readKey, readSignature, verify } from "openpgp";
import {
  MemoryStateStore,
  ValidationError,
  type PublishArtifactsInput,
} from "@axis-repository/core";
import {
  MemoryRepositoryObjectStore,
  OpenPgpSigner,
  RepositorySecretService,
  SecretEncryption,
} from "@axis-repository/runtime-cloudflare/plugin-runtime/testing";
import { AptPublisher } from "./publisher";
import { AptSigningKeyResource } from "./signing-keys";
import { debArchive } from "./deb-fixtures.test-support";

async function createSigningKey(state: MemoryStateStore) {
  const key = await generateKey({
    type: "ecc",
    curve: "curve25519Legacy",
    userIDs: [{ name: "Axis Test", email: "axis@example.test" }],
    passphrase: "correct-passphrase",
    date: new Date("2026-07-18T00:00:00.000Z"),
  });
  const service = new AptSigningKeyResource({
    secrets: new RepositorySecretService({
      state,
      clock: { now: () => new Date("2026-07-18T00:00:00.000Z") },
      randomId: { create: () => "signing_key_prod" },
      encryption: new SecretEncryption("local-test-secret"),
    }),
  });
  await service.create({
    repositoryName: "debian-internal",
    name: "debian-prod",
    privateKeyArmored: key.privateKey,
    passphrase: "correct-passphrase",
  });
  return { service, publicKeyArmored: key.publicKey };
}

function debFixture(input: {
  packageName?: string;
  version?: string;
  architecture?: string;
  description?: string;
  maintainer?: string;
  depends?: string;
} = {}): Uint8Array {
  return debArchive({
    control: [
      `Package: ${input.packageName ?? "myapp"}`,
      `Version: ${input.version ?? "1.2.3"}`,
      `Architecture: ${input.architecture ?? "amd64"}`,
      `Maintainer: ${input.maintainer ?? "Release Team <release@example.com>"}`,
      `Description: ${input.description ?? "Example package"}`,
      ...(input.depends ? [`Depends: ${input.depends}`] : []),
      "",
    ].join("\n"),
  });
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
      debFixture(),
      "application/vnd.debian.binary-package",
    );
    const publisher = new AptPublisher({
      objectStoreFor: () => objectStore,
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
        key: "repositories/debian-internal/dists/noble/main/i18n/Translation-en",
        contentType: "text/plain; charset=utf-8",
      },
      {
        key: "repositories/debian-internal/dists/noble/main/i18n/Translation-en.gz",
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

  it("fills missing APT artifact metadata from uploaded deb control metadata", async () => {
    const state = new MemoryStateStore();
    const { service: signingKeyService } = await createSigningKey(state);
    const objectStore = new MemoryRepositoryObjectStore();
    await objectStore.putBytes(
      "_staging/uploads/pub_1/upl_1/myapp_1.2.3_amd64.deb",
      debFixture({ depends: "libc6" }),
      "application/vnd.debian.binary-package",
    );
    const input = publishInput();
    input.artifacts[0]!.artifact.metadata = {
      component: "main",
    };
    const publisher = new AptPublisher({
      objectStoreFor: () => objectStore,
      signingKeys: signingKeyService,
      signer: new OpenPgpSigner(),
    });

    await publisher.publish(input);

    const packages = findStoredString(objectStore, "repositories/debian-internal/dists/noble/main/binary-amd64/Packages");
    expect(packages).toContain("Package: myapp");
    expect(packages).toContain("Version: 1.2.3");
    expect(packages).toContain("Architecture: amd64");
    expect(packages).toContain("Maintainer: Release Team <release@example.com>");
    expect(packages).toContain("Depends: libc6");
  });

  it("carries the dependency-resolution control fields from the deb into Packages", async () => {
    const state = new MemoryStateStore();
    const { service: signingKeyService } = await createSigningKey(state);
    const objectStore = new MemoryRepositoryObjectStore();
    await objectStore.putBytes(
      "_staging/uploads/pub_1/upl_1/myapp_1.2.3_amd64.deb",
      debArchive({
        control: [
          "Package: myapp",
          "Source: myapp-src",
          "Version: 1.2.3",
          "Architecture: amd64",
          "Installed-Size: 2048",
          "Multi-Arch: foreign",
          "Maintainer: Release Team <release@example.com>",
          "Pre-Depends: libc6 (>= 2.34)",
          "Depends: libssl3",
          "Breaks: myapp-plugin (<< 2.0)",
          "Enhances: myapp-extras",
          "Built-Using: openssl (= 3.0.2-0ubuntu1)",
          "Description: Example package",
          " The long form of the description,",
          " .",
          " with a second paragraph.",
          "",
        ].join("\n"),
      }),
      "application/vnd.debian.binary-package",
    );
    const input = publishInput();
    input.artifacts[0]!.artifact.metadata = { component: "main" };
    const publisher = new AptPublisher({
      objectStoreFor: () => objectStore,
      signingKeys: signingKeyService,
      signer: new OpenPgpSigner(),
    });

    await publisher.publish(input);

    const packages = findStoredString(objectStore, "repositories/debian-internal/dists/noble/main/binary-amd64/Packages");
    expect(packages).toContain("Source: myapp-src\n");
    expect(packages).toContain("Installed-Size: 2048\n");
    expect(packages).toContain("Multi-Arch: foreign\n");
    expect(packages).toContain("Pre-Depends: libc6 (>= 2.34)\n");
    expect(packages).toContain("Breaks: myapp-plugin (<< 2.0)\n");
    expect(packages).toContain("Enhances: myapp-extras\n");
    expect(packages).toContain("Built-Using: openssl (= 3.0.2-0ubuntu1)\n");
    expect(packages).toContain(
      "Description: Example package\n The long form of the description,\n .\n with a second paragraph.\n",
    );
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
      await objectStore.putBytes(
        artifact.verified.objectKey,
        debFixture({
          packageName: String(artifact.artifact.metadata.package),
          version: String(artifact.artifact.metadata.version),
          architecture: String(artifact.artifact.metadata.architecture),
        }),
        artifact.artifact.contentType,
      );
    }
    const publisher = new AptPublisher({
      objectStoreFor: () => objectStore,
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
      // Nothing was published to contrib/arm64, but Release names both the
      // component and the architecture, and apt refuses a Release that names
      // a pair it has no index for.
      "repositories/debian-internal/dists/noble/contrib/binary-arm64/Packages",
      "repositories/debian-internal/dists/noble/contrib/binary-arm64/Packages.gz",
      "repositories/debian-internal/dists/noble/main/i18n/Translation-en",
      "repositories/debian-internal/dists/noble/main/i18n/Translation-en.gz",
      "repositories/debian-internal/dists/noble/contrib/i18n/Translation-en",
      "repositories/debian-internal/dists/noble/contrib/i18n/Translation-en.gz",
      "repositories/debian-internal/dists/noble/Release",
      "repositories/debian-internal/dists/noble/InRelease",
      "repositories/debian-internal/dists/noble/Release.gpg",
    ]);
  });

  it("marks APT metadata writes that replace existing repository objects", async () => {
    const state = new MemoryStateStore();
    const { service: signingKeyService } = await createSigningKey(state);
    const objectStore = new MemoryRepositoryObjectStore();
    await objectStore.putBytes(
      "_staging/uploads/pub_1/upl_1/myapp_1.2.3_amd64.deb",
      debFixture(),
      "application/vnd.debian.binary-package",
    );
    await objectStore.putText(
      "repositories/debian-internal/dists/noble/Release",
      "old release",
      "text/plain",
    );
    const publisher = new AptPublisher({
      objectStoreFor: () => objectStore,
      signingKeys: signingKeyService,
      signer: new OpenPgpSigner(),
    });

    const result = await publisher.publish(publishInput());

    expect(result.objects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: "repositories/debian-internal/dists/noble/Release",
        previous: expect.objectContaining({
          contentType: "text/plain",
          size: 11,
        }),
      }),
    ]));
  });

  it("publishes byte-identical signed metadata for the same input and publish timestamp", async () => {
    const state = new MemoryStateStore();
    const { service: signingKeyService } = await createSigningKey(state);
    const firstStore = new MemoryRepositoryObjectStore();
    const secondStore = new MemoryRepositoryObjectStore();
    for (const objectStore of [firstStore, secondStore]) {
      await objectStore.putBytes(
        "_staging/uploads/pub_1/upl_1/myapp_1.2.3_amd64.deb",
        debFixture(),
        "application/vnd.debian.binary-package",
      );
    }
    const firstPublisher = new AptPublisher({
      objectStoreFor: () => firstStore,
      signingKeys: signingKeyService,
      signer: new OpenPgpSigner(),
    });
    const secondPublisher = new AptPublisher({
      objectStoreFor: () => secondStore,
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
      objectStoreFor: () => new MemoryRepositoryObjectStore(),
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
    await objectStore.putBytes(
      "_staging/uploads/pub_1/upl_1/myapp_1.2.3_amd64.deb",
      debFixture(),
      "application/vnd.debian.binary-package",
    );
    const publisher = new AptPublisher({
      objectStoreFor: () => objectStore,
      signingKeys: signingKeyService,
      signer: new OpenPgpSigner(),
    });

    await expect(publisher.publish(publishInput())).rejects.toBeInstanceOf(ValidationError);
    expect(repositoryObjects(objectStore)).toEqual([]);
  });

  it("does not write objects when signing fails", async () => {
    const state = new MemoryStateStore();
    const { service: signingKeyService } = await createSigningKey(state);
    const objectStore = new MemoryRepositoryObjectStore();
    await objectStore.putBytes(
      "_staging/uploads/pub_1/upl_1/myapp_1.2.3_amd64.deb",
      debFixture(),
      "application/vnd.debian.binary-package",
    );
    const publisher = new AptPublisher({
      objectStoreFor: () => objectStore,
      signingKeys: signingKeyService,
      signer: {
        clearSign: async () => "-----BEGIN PGP SIGNED MESSAGE-----\n",
        detachSign: async () => {
          throw new Error("signing failed");
        },
      },
    });

    await expect(publisher.publish(publishInput())).rejects.toThrow("signing failed");
    expect(repositoryObjects(objectStore)).toEqual([]);
  });
});

function findStoredString(objectStore: MemoryRepositoryObjectStore, key: string): string {
  // The memory store appends rather than overwriting, so the last entry for a
  // key is the current one. Reading the first would return a stale index.
  const object = [...objectStore.objects].reverse().find((candidate) => candidate.key === key);
  expect(object?.value).toEqual(expect.any(String));
  return object!.value as string;
}

function repositoryObjects(objectStore: MemoryRepositoryObjectStore) {
  // When each object was stored is the store's own bookkeeping, not part of
  // what was published, and two runs of the same publish are never at the
  // same instant.
  return objectStore.objects
    .filter((object) => object.key.startsWith("repositories/"))
    .map(({ uploadedAt, ...object }) => object);
}
