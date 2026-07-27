import { describe, expect, it } from "vitest";
import { zstdDecompressSync } from "node:zlib";
import { generateKey, readKey, readCleartextMessage, verify } from "openpgp";
import { MemoryStateStore, type PublishArtifactsInput, type Repository } from "@axis-repository/core";
import {
  MemoryRepositoryObjectStore,
  OpenPgpSigner,
  RepositorySecretService,
  SecretEncryption,
} from "@axis-repository/runtime-cloudflare/plugin-runtime/testing";
import { AptPublisher } from "./publisher";
import { AptSigningKeyResource } from "./signing-keys";
import { reconcileAptRepository } from "./rebuild";
import { debArchive } from "./deb-fixtures.test-support";

const clock = { now: () => new Date("2026-07-18T00:00:00.000Z") };

async function createSigningKeys(state: MemoryStateStore) {
  const key = await generateKey({
    type: "ecc",
    curve: "curve25519Legacy",
    userIDs: [{ name: "Axis Test", email: "axis@example.test" }],
    passphrase: "correct-passphrase",
    date: clock.now(),
  });
  const service = new AptSigningKeyResource({
    secrets: new RepositorySecretService({
      state,
      clock,
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

function repository(overrides: Partial<Record<string, unknown>> = {}): Repository {
  return {
    id: "repo_1",
    name: "debian-internal",
    ecosystem: "apt",
    visibility: "private",
    config: {
      apt: {
        codename: "noble",
        components: ["main"],
        signingKeyId: "signing_key_prod",
        ...overrides,
      },
    },
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
  };
}

interface FixturePackage {
  name: string;
  version: string;
  architecture?: string;
  suite?: string;
  files?: string[];
  /** Publishes the package as an installer .udeb rather than a .deb. */
  installer?: boolean;
}

/** An uploaded file that is not a binary package: a .dsc or one of its tarballs. */
interface FixtureFile {
  filename: string;
  body: string;
  suite?: string;
}

function publishInput(sessionId: string, packages: FixturePackage[], repositoryOverrides = {}): PublishArtifactsInput {
  return {
    repository: repository(repositoryOverrides),
    session: {
      id: sessionId,
      repositoryName: "debian-internal",
      ecosystem: "apt",
      status: "finalizing",
      requestedBy: {
        tokenId: "ptok_1",
        name: "ci",
        permissions: ["publish"],
        repositories: ["debian-internal"],
        ecosystemScopes: {},
        signingKeyIds: ["signing_key_prod"],
      },
      artifacts: [],
      uploads: [],
      verifiedUploads: [],
      createdAt: "2026-07-18T00:00:00.000Z",
      expiresAt: "2026-07-18T01:00:00.000Z",
      publishStartedAt: "2026-07-18T00:10:00.000Z",
    },
    artifacts: packages.map((fixture, index) => {
      const architecture = fixture.architecture ?? "amd64";
      const filename = `${fixture.name}_${fixture.version}_${architecture}.${fixture.installer ? "udeb" : "deb"}`;
      const objectKey = `_staging/uploads/${sessionId}/upl_${index + 1}/${filename}`;
      return {
        artifact: {
          filename,
          size: 1234,
          sha256: "a".repeat(64),
          contentType: "application/vnd.debian.binary-package",
          metadata: { component: "main", ...(fixture.suite ? { suite: fixture.suite } : {}) },
        },
        upload: {
          uploadId: `upl_${index + 1}`,
          filename,
          objectKey,
          method: "PUT",
          url: "https://uploads.local",
          headers: {},
          expiresAt: "2026-07-18T00:20:00.000Z",
        },
        verified: {
          uploadId: `upl_${index + 1}`,
          objectKey,
          size: 1234,
          sha256: "a".repeat(64),
          verifiedAt: "2026-07-18T00:05:00.000Z",
        },
      };
    }),
  };
}

async function seedUploads(
  objectStore: MemoryRepositoryObjectStore,
  sessionId: string,
  packages: FixturePackage[],
): Promise<void> {
  for (const [index, fixture] of packages.entries()) {
    const architecture = fixture.architecture ?? "amd64";
    const filename = `${fixture.name}_${fixture.version}_${architecture}.${fixture.installer ? "udeb" : "deb"}`;
    await objectStore.putBytes(
      `_staging/uploads/${sessionId}/upl_${index + 1}/${filename}`,
      debArchive({
        control: [
          `Package: ${fixture.name}`,
          `Version: ${fixture.version}`,
          `Architecture: ${architecture}`,
          "Maintainer: Release Team <release@example.com>",
          "Section: utils",
          `Description: ${fixture.name} package`,
          "",
        ].join("\n"),
        ...(fixture.files ? { files: fixture.files } : {}),
      }),
      "application/vnd.debian.binary-package",
    );
  }
}

function storedText(objectStore: MemoryRepositoryObjectStore, key: string): string | undefined {
  const object = [...objectStore.objects].reverse().find((candidate) => candidate.key === key);
  return typeof object?.value === "string" ? object.value : undefined;
}

function storedKeys(objectStore: MemoryRepositoryObjectStore): string[] {
  const live = new Set<string>();
  for (const object of objectStore.objects) {
    live.add(object.key);
  }
  return [...live].filter((key) => key.startsWith("repositories/")).sort();
}

/** Reads an object regardless of whether it was stored as text or bytes. */
function storedContent(objectStore: MemoryRepositoryObjectStore, key: string): string | undefined {
  const value = [...objectStore.objects].reverse().find((candidate) => candidate.key === key)?.value;
  if (typeof value === "string") {
    return value;
  }
  return value instanceof Uint8Array ? new TextDecoder().decode(value) : undefined;
}

function storedBytes(objectStore: MemoryRepositoryObjectStore, key: string): Uint8Array | undefined {
  const value = [...objectStore.objects].reverse().find((candidate) => candidate.key === key)?.value;
  return value instanceof Uint8Array ? value : undefined;
}

function byHashKeys(objectStore: MemoryRepositoryObjectStore): string[] {
  return storedKeys(objectStore).filter((key) => key.includes("/by-hash/"));
}

const PACKAGES_KEY = "repositories/debian-internal/dists/noble/main/binary-amd64/Packages";
const CONTENTS_KEY = "repositories/debian-internal/dists/noble/main/Contents-amd64.gz";
const INSTALLER_PACKAGES_KEY = "repositories/debian-internal/dists/noble/main/debian-installer/binary-amd64/Packages";
const SOURCES_KEY = "repositories/debian-internal/dists/noble/main/source/Sources";

const ORIG_TARBALL = "orig tarball";
const DEBIAN_TARBALL = "debian tarball";

function dsc(input: { version: string; debianTarballSize?: number }): string {
  const revision = input.version.split("-")[1] ?? "1";
  const debianSize = input.debianTarballSize ?? DEBIAN_TARBALL.length;
  return [
    "Format: 3.0 (quilt)",
    "Source: myapp",
    "Binary: myapp",
    "Architecture: any",
    `Version: ${input.version}`,
    "Maintainer: Release Team <release@example.com>",
    "Checksums-Sha256:",
    ` ${"a".repeat(64)} ${ORIG_TARBALL.length} myapp_1.2.3.orig.tar.xz`,
    ` ${"b".repeat(64)} ${debianSize} myapp_1.2.3-${revision}.debian.tar.xz`,
    "Files:",
    ` ${"c".repeat(32)} ${ORIG_TARBALL.length} myapp_1.2.3.orig.tar.xz`,
    ` ${"d".repeat(32)} ${debianSize} myapp_1.2.3-${revision}.debian.tar.xz`,
    "",
  ].join("\n");
}

async function gunzipStored(objectStore: MemoryRepositoryObjectStore, key: string): Promise<string> {
  const value = [...objectStore.objects].reverse().find((candidate) => candidate.key === key)?.value;
  if (!(value instanceof Uint8Array)) {
    throw new Error(`expected gzipped bytes at ${key}`);
  }
  const stream = new Blob([value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

function packagesKey(suite: string, architecture = "amd64"): string {
  return `repositories/debian-internal/dists/${suite}/main/binary-${architecture}/Packages`;
}

async function createHarness() {
  const state = new MemoryStateStore();
  const { service: signingKeys, publicKeyArmored } = await createSigningKeys(state);
  const objectStore = new MemoryRepositoryObjectStore();
  const publisher = new AptPublisher({
    objectStoreFor: () => objectStore,
    signingKeys,
    signer: new OpenPgpSigner(),
  });

  return {
    objectStore,
    signingKeys,
    publicKeyArmored,
    async publish(sessionId: string, packages: FixturePackage[], repositoryOverrides = {}) {
      await seedUploads(objectStore, sessionId, packages);
      return publisher.publish(publishInput(sessionId, packages, repositoryOverrides));
    },
    async publishFiles(sessionId: string, files: FixtureFile[], repositoryOverrides = {}) {
      const input = publishInput(sessionId, [], repositoryOverrides);
      input.artifacts = await Promise.all(files.map(async (file, index) => {
        const objectKey = `_staging/uploads/${sessionId}/upl_${index + 1}/${file.filename}`;
        await objectStore.putText(objectKey, file.body, "text/plain");
        return {
          artifact: {
            filename: file.filename,
            size: file.body.length,
            sha256: "a".repeat(64),
            contentType: "text/plain",
            metadata: { component: "main", ...(file.suite ? { suite: file.suite } : {}) },
          },
          upload: {
            uploadId: `upl_${index + 1}`,
            filename: file.filename,
            objectKey,
            method: "PUT",
            url: "https://uploads.local",
            headers: {},
            expiresAt: "2026-07-18T00:20:00.000Z",
          },
          verified: {
            uploadId: `upl_${index + 1}`,
            objectKey,
            size: file.body.length,
            sha256: "a".repeat(64),
            verifiedAt: "2026-07-18T00:05:00.000Z",
          },
        };
      }));
      return publisher.publish(input);
    },
    async reconcile(repositoryOverrides = {}) {
      return reconcileAptRepository({
        repository: repository(repositoryOverrides),
        objectStore,
        signingKeys,
        signer: new OpenPgpSigner(),
        now: new Date("2026-07-19T00:00:00.000Z"),
      });
    },
  };
}

describe("APT index lifecycle", () => {
  it("keeps packages from earlier publishes when publishing again", async () => {
    const harness = await createHarness();

    await harness.publish("pub_1", [{ name: "alpha", version: "1.0.0" }]);
    await harness.publish("pub_2", [{ name: "beta", version: "2.0.0" }]);

    const packages = storedText(harness.objectStore, PACKAGES_KEY) ?? "";
    expect(packages).toContain("Package: alpha\n");
    expect(packages).toContain("Package: beta\n");
    expect(storedKeys(harness.objectStore)).toContain(
      "repositories/debian-internal/pool/main/alpha/alpha_1.0.0_amd64.deb",
    );
  });

  it("re-signs Release over the merged index so apt still accepts it", async () => {
    const harness = await createHarness();

    await harness.publish("pub_1", [{ name: "alpha", version: "1.0.0" }]);
    await harness.publish("pub_2", [{ name: "beta", version: "2.0.0" }]);

    const release = storedText(harness.objectStore, "repositories/debian-internal/dists/noble/Release") ?? "";
    const inRelease = storedText(harness.objectStore, "repositories/debian-internal/dists/noble/InRelease") ?? "";
    const packagesBytes = new TextEncoder().encode(storedText(harness.objectStore, PACKAGES_KEY) ?? "");
    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", packagesBytes))]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");

    expect(release).toContain(` ${digest} ${packagesBytes.byteLength} main/binary-amd64/Packages\n`);
    const cleartext = await readCleartextMessage({ cleartextMessage: inRelease });
    expect(cleartext.getText()).toBe(release);
    const verified = await verify({
      message: cleartext,
      verificationKeys: await readKey({ armoredKey: harness.publicKeyArmored }),
    });
    await expect(verified.signatures[0]!.verified).resolves.toBe(true);
  });

  it("replaces a stanza when the same package version is published again", async () => {
    const harness = await createHarness();

    await harness.publish("pub_1", [{ name: "alpha", version: "1.0.0" }]);
    await harness.publish("pub_2", [{ name: "alpha", version: "1.0.0" }]);

    const packages = storedText(harness.objectStore, PACKAGES_KEY) ?? "";
    expect(packages.match(/^Package: alpha$/gm)).toHaveLength(1);
  });

  it("keeps an architecture in Release when a later publish does not touch it", async () => {
    const harness = await createHarness();

    await harness.publish("pub_1", [{ name: "alpha", version: "1.0.0", architecture: "arm64" }]);
    await harness.publish("pub_2", [{ name: "beta", version: "2.0.0", architecture: "amd64" }]);

    const release = storedText(harness.objectStore, "repositories/debian-internal/dists/noble/Release") ?? "";
    expect(release).toContain("Architectures: amd64 arm64\n");
    expect(release).toContain("main/binary-arm64/Packages\n");
    expect(storedText(harness.objectStore, "repositories/debian-internal/dists/noble/main/binary-arm64/Packages"))
      .toContain("Package: alpha\n");
  });

  it("drops a package from the index once its pool object is gone", async () => {
    const harness = await createHarness();

    await harness.publish("pub_1", [
      { name: "alpha", version: "1.0.0" },
      { name: "beta", version: "2.0.0" },
    ]);
    await harness.objectStore.deleteObject("repositories/debian-internal/pool/main/alpha/alpha_1.0.0_amd64.deb");

    const artifacts = await harness.reconcile();

    const packages = storedText(harness.objectStore, PACKAGES_KEY) ?? "";
    expect(packages).not.toContain("Package: alpha\n");
    expect(packages).toContain("Package: beta\n");
    expect(artifacts.map((artifact) => artifact.name)).toEqual(["beta"]);
  });

  it("removes an index file when its last package is deleted, so Release stays consistent", async () => {
    const harness = await createHarness();

    await harness.publish("pub_1", [{ name: "alpha", version: "1.0.0", architecture: "arm64" }]);
    await harness.publish("pub_2", [{ name: "beta", version: "2.0.0", architecture: "amd64" }]);
    await harness.objectStore.deleteObject("repositories/debian-internal/pool/main/alpha/alpha_1.0.0_arm64.deb");

    await harness.reconcile();

    const release = storedText(harness.objectStore, "repositories/debian-internal/dists/noble/Release") ?? "";
    expect(release).not.toContain("main/binary-arm64/Packages");
    expect(storedKeys(harness.objectStore)).not.toContain(
      "repositories/debian-internal/dists/noble/main/binary-arm64/Packages",
    );
  });

  it("re-signs Release after reconciling so the signature still covers the index", async () => {
    const harness = await createHarness();

    await harness.publish("pub_1", [
      { name: "alpha", version: "1.0.0" },
      { name: "beta", version: "2.0.0" },
    ]);
    await harness.objectStore.deleteObject("repositories/debian-internal/pool/main/alpha/alpha_1.0.0_amd64.deb");
    await harness.reconcile();

    const release = storedText(harness.objectStore, "repositories/debian-internal/dists/noble/Release") ?? "";
    const inRelease = storedText(harness.objectStore, "repositories/debian-internal/dists/noble/InRelease") ?? "";
    const cleartext = await readCleartextMessage({ cleartextMessage: inRelease });

    expect(cleartext.getText()).toBe(release);
    const verified = await verify({
      message: cleartext,
      verificationKeys: await readKey({ armoredKey: harness.publicKeyArmored }),
    });
    await expect(verified.signatures[0]!.verified).resolves.toBe(true);
  });

  it("adds a pool object that was never indexed", async () => {
    const harness = await createHarness();

    await harness.publish("pub_1", [{ name: "alpha", version: "1.0.0" }]);
    await harness.objectStore.putBytes(
      "repositories/debian-internal/pool/main/gamma/gamma_3.0.0_amd64.deb",
      debArchive({
        control: [
          "Package: gamma",
          "Version: 3.0.0",
          "Architecture: amd64",
          "Maintainer: Release Team <release@example.com>",
          "Description: gamma package",
          "",
        ].join("\n"),
      }),
      "application/vnd.debian.binary-package",
    );

    const artifacts = await harness.reconcile();

    expect(storedText(harness.objectStore, PACKAGES_KEY)).toContain("Package: gamma\n");
    expect(artifacts.map((artifact) => artifact.name).sort()).toEqual(["alpha", "gamma"]);
  });

  it("publishes each index under by-hash and keeps one older generation", async () => {
    const harness = await createHarness();

    await harness.publish("pub_1", [{ name: "alpha", version: "1.0.0" }]);
    const firstGeneration = byHashKeys(harness.objectStore);
    // Packages and Translation-en, each in plain, gzip and zstd form, each of
    // those under its SHA256 and its SHA512.
    expect(firstGeneration).toHaveLength(12);

    await harness.publish("pub_2", [{ name: "beta", version: "2.0.0" }]);
    const secondGeneration = byHashKeys(harness.objectStore);

    // The Release a client just read still names the first generation, so it
    // has to survive one more publish.
    for (const key of firstGeneration) {
      expect(secondGeneration).toContain(key);
    }
    expect(secondGeneration).toHaveLength(24);
    const firstPackagesByHash = firstGeneration
      .map((key) => storedContent(harness.objectStore, key))
      .filter((content) => content?.startsWith("Package: "));
    expect(firstPackagesByHash.length).toBeGreaterThan(0);
    for (const content of firstPackagesByHash) {
      expect(content).toContain("Package: alpha\n");
    }

    await harness.publish("pub_3", [{ name: "gamma", version: "3.0.0" }]);
    const thirdGeneration = byHashKeys(harness.objectStore);

    // Anything older than that is dropped, so by-hash cannot grow without end.
    expect(thirdGeneration).toHaveLength(24);
    for (const key of firstGeneration) {
      expect(thirdGeneration).not.toContain(key);
    }
  });

  it("publishes a zstd index that Release vouches for", async () => {
    const harness = await createHarness();

    await harness.publish("pub_1", [{ name: "alpha", version: "1.0.0" }]);

    const plain = storedText(harness.objectStore, PACKAGES_KEY) ?? "";
    const compressed = storedBytes(harness.objectStore, `${PACKAGES_KEY}.zst`);
    expect(compressed).toBeDefined();
    // The reference decompressor has to accept it, or apt will not either.
    expect(new TextDecoder().decode(zstdDecompressSync(Buffer.from(compressed!)))).toBe(plain);

    const release = storedText(harness.objectStore, "repositories/debian-internal/dists/noble/Release") ?? "";
    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", compressed!))]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    expect(release).toContain(` ${digest} ${compressed!.byteLength} main/binary-amd64/Packages.zst\n`);
    // Publishing both means a client too old for zstd still has the gzip form.
    expect(release).toContain(" main/binary-amd64/Packages.gz\n");
  });

  it("stops writing by-hash copies when the repository turns it off", async () => {
    const harness = await createHarness();

    await harness.publish("pub_1", [{ name: "alpha", version: "1.0.0" }], { acquireByHash: false });

    expect(byHashKeys(harness.objectStore)).toEqual([]);
    expect(storedText(harness.objectStore, "repositories/debian-internal/dists/noble/Release"))
      .toContain("Acquire-By-Hash: no\n");
  });

  it("publishes each suite into its own dists tree", async () => {
    const suites = { suites: ["noble", "jammy"] };
    const harness = await createHarness();

    await harness.publish("pub_1", [{ name: "alpha", version: "1.0.0" }], suites);
    await harness.publish("pub_2", [{ name: "beta", version: "2.0.0", suite: "jammy" }], suites);

    expect(storedText(harness.objectStore, packagesKey("noble"))).toContain("Package: alpha\n");
    expect(storedText(harness.objectStore, packagesKey("noble"))).not.toContain("Package: beta\n");
    expect(storedText(harness.objectStore, packagesKey("jammy"))).toContain("Package: beta\n");
    expect(storedText(harness.objectStore, packagesKey("jammy"))).not.toContain("Package: alpha\n");
  });

  it("names each suite in its own Release and signs both", async () => {
    const suites = { suites: ["noble", "jammy"] };
    const harness = await createHarness();

    await harness.publish("pub_1", [
      { name: "alpha", version: "1.0.0" },
      { name: "beta", version: "2.0.0", suite: "jammy" },
    ], suites);

    const publicKey = await readKey({ armoredKey: harness.publicKeyArmored });
    for (const suite of ["noble", "jammy"]) {
      const release = storedText(harness.objectStore, `repositories/debian-internal/dists/${suite}/Release`) ?? "";
      const inRelease = storedText(harness.objectStore, `repositories/debian-internal/dists/${suite}/InRelease`) ?? "";
      expect(release).toContain(`Codename: ${suite}\n`);
      expect(release).toContain(`Suite: ${suite}\n`);

      const cleartext = await readCleartextMessage({ cleartextMessage: inRelease });
      expect(cleartext.getText()).toBe(release);
      const verified = await verify({ message: cleartext, verificationKeys: publicKey });
      await expect(verified.signatures[0]!.verified).resolves.toBe(true);
    }
  });

  it("shares one pool object between the suites that index it", async () => {
    const suites = { suites: ["noble", "jammy"] };
    const harness = await createHarness();

    await harness.publish("pub_1", [{ name: "alpha", version: "1.0.0" }], suites);
    await harness.publish("pub_2", [{ name: "alpha", version: "1.0.0", suite: "jammy" }], suites);

    expect(storedKeys(harness.objectStore).filter((key) => key.includes("/pool/"))).toEqual([
      "repositories/debian-internal/pool/main/alpha/alpha_1.0.0_amd64.deb",
    ]);
    for (const suite of ["noble", "jammy"]) {
      expect(storedText(harness.objectStore, packagesKey(suite))).toContain(
        "Filename: pool/main/alpha/alpha_1.0.0_amd64.deb\n",
      );
    }
  });

  it("drops a deleted package from every suite that indexed it", async () => {
    const suites = { suites: ["noble", "jammy"] };
    const harness = await createHarness();

    await harness.publish("pub_1", [{ name: "alpha", version: "1.0.0" }], suites);
    await harness.publish("pub_2", [
      { name: "alpha", version: "1.0.0", suite: "jammy" },
      { name: "beta", version: "2.0.0", suite: "jammy" },
    ], suites);
    await harness.objectStore.deleteObject("repositories/debian-internal/pool/main/alpha/alpha_1.0.0_amd64.deb");

    await harness.reconcile(suites);

    expect(storedText(harness.objectStore, packagesKey("jammy"))).toContain("Package: beta\n");
    for (const suite of ["noble", "jammy"]) {
      expect(storedText(harness.objectStore, packagesKey(suite)) ?? "").not.toContain("Package: alpha\n");
    }
  });

  it("refuses a publish aimed at a suite the repository does not declare", async () => {
    const harness = await createHarness();

    await expect(harness.publish("pub_1", [{ name: "alpha", version: "1.0.0", suite: "jammy" }], {
      suites: ["noble"],
    })).rejects.toThrow("artifact metadata suite is not configured for this repository");
  });

  it("publishes a Contents index naming the files each package installs", async () => {
    const harness = await createHarness();

    await harness.publish("pub_1", [
      { name: "alpha", version: "1.0.0", files: ["usr/bin/alpha", "etc/alpha.conf"] },
      { name: "beta", version: "2.0.0", files: ["usr/bin/beta"] },
    ]);

    const contents = await gunzipStored(harness.objectStore, CONTENTS_KEY);
    expect(contents).toContain("usr/bin/alpha utils/alpha\n");
    expect(contents).toContain("etc/alpha.conf utils/alpha\n");
    expect(contents).toContain("usr/bin/beta utils/beta\n");
    expect(storedText(harness.objectStore, "repositories/debian-internal/dists/noble/Release"))
      .toContain("main/Contents-amd64.gz\n");
  });

  it("keeps the Contents of packages a later publish does not touch", async () => {
    const harness = await createHarness();

    await harness.publish("pub_1", [{ name: "alpha", version: "1.0.0", files: ["usr/bin/alpha"] }]);
    await harness.publish("pub_2", [{ name: "beta", version: "2.0.0", files: ["usr/bin/beta"] }]);

    const contents = await gunzipStored(harness.objectStore, CONTENTS_KEY);
    expect(contents).toContain("usr/bin/alpha utils/alpha\n");
    expect(contents).toContain("usr/bin/beta utils/beta\n");
  });

  it("replaces the Contents of a package republished with different files", async () => {
    const harness = await createHarness();

    await harness.publish("pub_1", [{ name: "alpha", version: "1.0.0", files: ["usr/bin/alpha-old"] }]);
    await harness.publish("pub_2", [{ name: "alpha", version: "1.0.0", files: ["usr/bin/alpha-new"] }]);

    const contents = await gunzipStored(harness.objectStore, CONTENTS_KEY);
    expect(contents).toContain("usr/bin/alpha-new utils/alpha\n");
    expect(contents).not.toContain("usr/bin/alpha-old");
  });

  it("drops a package from Contents once its pool object is gone", async () => {
    const harness = await createHarness();

    await harness.publish("pub_1", [
      { name: "alpha", version: "1.0.0", files: ["usr/bin/alpha"] },
      { name: "beta", version: "2.0.0", files: ["usr/bin/beta"] },
    ]);
    await harness.objectStore.deleteObject("repositories/debian-internal/pool/main/alpha/alpha_1.0.0_amd64.deb");

    await harness.reconcile();

    const contents = await gunzipStored(harness.objectStore, CONTENTS_KEY);
    expect(contents).not.toContain("usr/bin/alpha");
    expect(contents).toContain("usr/bin/beta utils/beta\n");
  });

  it("publishes installer packages into their own debian-installer index", async () => {
    const harness = await createHarness();

    await harness.publish("pub_1", [
      { name: "alpha", version: "1.0.0" },
      { name: "alpha-udeb", version: "1.0.0", installer: true },
    ]);

    expect(storedText(harness.objectStore, PACKAGES_KEY)).toContain("Package: alpha\n");
    expect(storedText(harness.objectStore, PACKAGES_KEY)).not.toContain("Package: alpha-udeb\n");
    expect(storedText(harness.objectStore, INSTALLER_PACKAGES_KEY)).toContain("Package: alpha-udeb\n");
    expect(storedText(harness.objectStore, "repositories/debian-internal/dists/noble/Release"))
      .toContain("main/debian-installer/binary-amd64/Packages\n");
  });

  it("publishes a source package into a Sources index", async () => {
    const harness = await createHarness();

    await harness.publishFiles("pub_1", [
      { filename: "myapp_1.2.3.orig.tar.xz", body: ORIG_TARBALL },
      { filename: "myapp_1.2.3-1.debian.tar.xz", body: DEBIAN_TARBALL },
      { filename: "myapp_1.2.3-1.dsc", body: dsc({ version: "1.2.3-1" }) },
    ]);

    const sources = storedText(harness.objectStore, SOURCES_KEY) ?? "";
    expect(sources).toContain("Package: myapp\n");
    expect(sources).toContain("Directory: pool/main/myapp\n");
    expect(sources).toContain("myapp_1.2.3-1.dsc");
    expect(storedKeys(harness.objectStore)).toEqual(expect.arrayContaining([
      "repositories/debian-internal/pool/main/myapp/myapp_1.2.3-1.dsc",
      "repositories/debian-internal/pool/main/myapp/myapp_1.2.3.orig.tar.xz",
      "repositories/debian-internal/pool/main/myapp/myapp_1.2.3-1.debian.tar.xz",
    ]));
    expect(storedText(harness.objectStore, "repositories/debian-internal/dists/noble/Release"))
      .toContain("main/source/Sources\n");
  });

  it("refuses a .dsc whose tarballs were never uploaded", async () => {
    const harness = await createHarness();

    await expect(harness.publishFiles("pub_1", [
      { filename: "myapp_1.2.3-1.dsc", body: dsc({ version: "1.2.3-1" }) },
    ])).rejects.toThrow("APT source .dsc references a file that was not uploaded");
  });

  it("accepts a revision that reuses an orig tarball already in the pool", async () => {
    const harness = await createHarness();

    await harness.publishFiles("pub_1", [
      { filename: "myapp_1.2.3.orig.tar.xz", body: ORIG_TARBALL },
      { filename: "myapp_1.2.3-1.debian.tar.xz", body: DEBIAN_TARBALL },
      { filename: "myapp_1.2.3-1.dsc", body: dsc({ version: "1.2.3-1" }) },
    ]);
    // The second revision ships only a new debian.tar, as dpkg-buildpackage
    // does when the upstream tarball has not changed.
    await harness.publishFiles("pub_2", [
      { filename: "myapp_1.2.3-2.debian.tar.xz", body: DEBIAN_TARBALL },
      { filename: "myapp_1.2.3-2.dsc", body: dsc({ version: "1.2.3-2" }) },
    ]);

    const sources = storedText(harness.objectStore, SOURCES_KEY) ?? "";
    expect(sources).toContain("Version: 1.2.3-1\n");
    expect(sources).toContain("Version: 1.2.3-2\n");
  });

  it("refuses a tarball whose size disagrees with the .dsc that names it", async () => {
    const harness = await createHarness();

    await expect(harness.publishFiles("pub_1", [
      { filename: "myapp_1.2.3.orig.tar.xz", body: ORIG_TARBALL },
      { filename: "myapp_1.2.3-1.debian.tar.xz", body: DEBIAN_TARBALL },
      { filename: "myapp_1.2.3-1.dsc", body: dsc({ version: "1.2.3-1", debianTarballSize: 999 }) },
    ])).rejects.toThrow("APT source file does not match the size its .dsc declares");
  });

  it("drops a source package from Sources once its .dsc is gone", async () => {
    const harness = await createHarness();

    await harness.publishFiles("pub_1", [
      { filename: "myapp_1.2.3.orig.tar.xz", body: ORIG_TARBALL },
      { filename: "myapp_1.2.3-1.debian.tar.xz", body: DEBIAN_TARBALL },
      { filename: "myapp_1.2.3-1.dsc", body: dsc({ version: "1.2.3-1" }) },
    ]);
    await harness.objectStore.deleteObject("repositories/debian-internal/pool/main/myapp/myapp_1.2.3-1.dsc");

    await harness.reconcile();

    expect(storedText(harness.objectStore, SOURCES_KEY)).toBeUndefined();
    expect(storedText(harness.objectStore, "repositories/debian-internal/dists/noble/Release"))
      .not.toContain("main/source/Sources");
  });

  it("does not require a signing key to reconcile a repository that has published nothing", async () => {
    const harness = await createHarness();

    await expect(harness.reconcile({ signingKeyId: "signing_key_missing" })).resolves.toEqual([]);
  });
});
