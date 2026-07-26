import { describe, expect, it } from "vitest";
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
      const filename = `${fixture.name}_${fixture.version}_${architecture}.deb`;
      const objectKey = `_staging/uploads/${sessionId}/upl_${index + 1}/${filename}`;
      return {
        artifact: {
          filename,
          size: 1234,
          sha256: "a".repeat(64),
          contentType: "application/vnd.debian.binary-package",
          metadata: { component: "main" },
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
    const filename = `${fixture.name}_${fixture.version}_${architecture}.deb`;
    await objectStore.putBytes(
      `_staging/uploads/${sessionId}/upl_${index + 1}/${filename}`,
      debArchive({
        control: [
          `Package: ${fixture.name}`,
          `Version: ${fixture.version}`,
          `Architecture: ${architecture}`,
          "Maintainer: Release Team <release@example.com>",
          `Description: ${fixture.name} package`,
          "",
        ].join("\n"),
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

const PACKAGES_KEY = "repositories/debian-internal/dists/noble/main/binary-amd64/Packages";

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

  it("does not require a signing key to reconcile a repository that has published nothing", async () => {
    const harness = await createHarness();

    await expect(harness.reconcile({ signingKeyId: "signing_key_missing" })).resolves.toEqual([]);
  });
});
