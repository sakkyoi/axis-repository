import { describe, expect, it } from "vitest";
import { generateKey, readCleartextMessage, readKey, verify } from "openpgp";
import { MemoryStateStore, type PublishArtifactsInput, type Repository } from "@axis-repository/core";
import {
  MemoryRepositoryObjectStore,
  OpenPgpSigner,
  RepositorySecretService,
  SecretEncryption,
} from "@axis-repository/runtime-cloudflare/plugin-runtime/testing";
import { AptPublisher } from "./publisher";
import { AptSigningKeyResource } from "./signing-keys";
import { renewAptReleaseSignatures } from "./maintenance";
import { debArchive } from "./deb-fixtures.test-support";

const PUBLISHED_AT = new Date("2026-07-18T00:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

async function createSigningKeys(state: MemoryStateStore) {
  const key = await generateKey({
    type: "ecc",
    curve: "curve25519Legacy",
    userIDs: [{ name: "Axis Test", email: "axis@example.test" }],
    passphrase: "correct-passphrase",
    date: PUBLISHED_AT,
  });
  const service = new AptSigningKeyResource({
    secrets: new RepositorySecretService({
      state,
      clock: { now: () => PUBLISHED_AT },
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

function repository(overrides: Record<string, unknown> = {}): Repository {
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
        validityDays: 10,
        ...overrides,
      },
    },
    createdAt: PUBLISHED_AT.toISOString(),
    updatedAt: PUBLISHED_AT.toISOString(),
  };
}

function publishInput(overrides: Record<string, unknown> = {}): PublishArtifactsInput {
  const objectKey = "_staging/uploads/pub_1/upl_1/alpha_1.0.0_amd64.deb";
  return {
    repository: repository(overrides),
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
        signingKeyIds: ["signing_key_prod"],
      },
      artifacts: [],
      uploads: [],
      verifiedUploads: [],
      createdAt: PUBLISHED_AT.toISOString(),
      expiresAt: new Date(PUBLISHED_AT.getTime() + 3600_000).toISOString(),
      publishStartedAt: PUBLISHED_AT.toISOString(),
    },
    artifacts: [{
      artifact: {
        filename: "alpha_1.0.0_amd64.deb",
        size: 1234,
        sha256: "a".repeat(64),
        contentType: "application/vnd.debian.binary-package",
        metadata: { component: "main" },
      },
      upload: {
        uploadId: "upl_1",
        filename: "alpha_1.0.0_amd64.deb",
        objectKey,
        method: "PUT",
        url: "https://uploads.local",
        headers: {},
        expiresAt: new Date(PUBLISHED_AT.getTime() + 3600_000).toISOString(),
      },
      verified: {
        uploadId: "upl_1",
        objectKey,
        size: 1234,
        sha256: "a".repeat(64),
        verifiedAt: PUBLISHED_AT.toISOString(),
      },
    }],
  };
}

function storedText(objectStore: MemoryRepositoryObjectStore, key: string): string | undefined {
  const object = [...objectStore.objects].reverse().find((candidate) => candidate.key === key);
  return typeof object?.value === "string" ? object.value : undefined;
}

const RELEASE_KEY = "repositories/debian-internal/dists/noble/Release";
const PACKAGES_KEY = "repositories/debian-internal/dists/noble/main/binary-amd64/Packages";

async function createHarness(configOverrides: Record<string, unknown> = {}) {
  const state = new MemoryStateStore();
  const { service: signingKeys, publicKeyArmored } = await createSigningKeys(state);
  const objectStore = new MemoryRepositoryObjectStore();
  await objectStore.putBytes(
    "_staging/uploads/pub_1/upl_1/alpha_1.0.0_amd64.deb",
    debArchive({
      control: [
        "Package: alpha",
        "Version: 1.0.0",
        "Architecture: amd64",
        "Maintainer: Release Team <release@example.com>",
        "Section: utils",
        "Description: alpha package",
        "",
      ].join("\n"),
    }),
    "application/vnd.debian.binary-package",
  );
  await new AptPublisher({
    objectStoreFor: () => objectStore,
    signingKeys,
    signer: new OpenPgpSigner(),
  }).publish(publishInput(configOverrides));

  return {
    objectStore,
    publicKeyArmored,
    renew: (now: Date) => renewAptReleaseSignatures({
      repository: repository(configOverrides),
      objectStore,
      signingKeys,
      signer: new OpenPgpSigner(),
      now,
    }),
  };
}

describe("renewing Release before it expires", () => {
  it("does nothing while the current Release still has most of its life", async () => {
    const harness = await createHarness();
    const before = storedText(harness.objectStore, RELEASE_KEY);

    // One day into a ten-day window: renewal is not due until day five.
    const result = await harness.renew(new Date(PUBLISHED_AT.getTime() + DAY_MS));

    expect(result.refreshed).toEqual([]);
    expect(storedText(harness.objectStore, RELEASE_KEY)).toBe(before);
    expect(result.nextDueAt?.toISOString()).toBe(new Date(PUBLISHED_AT.getTime() + 5 * DAY_MS).toISOString());
  });

  it("re-signs once the window is half gone, well before apt would refuse it", async () => {
    const harness = await createHarness();
    const before = storedText(harness.objectStore, RELEASE_KEY) ?? "";
    expect(before).toContain("Valid-Until: Tue, 28 Jul 2026 00:00:00 GMT");

    const renewedAt = new Date(PUBLISHED_AT.getTime() + 6 * DAY_MS);
    const result = await harness.renew(renewedAt);

    expect(result.refreshed).toEqual(["noble"]);
    const after = storedText(harness.objectStore, RELEASE_KEY) ?? "";
    expect(after).toContain("Date: Fri, 24 Jul 2026 00:00:00 GMT");
    expect(after).toContain("Valid-Until: Mon, 03 Aug 2026 00:00:00 GMT");
    // The next check lands halfway through the new window, not after it.
    expect(result.nextDueAt?.toISOString()).toBe(new Date(renewedAt.getTime() + 5 * DAY_MS).toISOString());
  });

  it("leaves the indexes byte-identical, so no client re-downloads anything", async () => {
    const harness = await createHarness();
    const packagesBefore = storedText(harness.objectStore, PACKAGES_KEY);
    const byHashBefore = harness.objectStore.objects
      .filter((object) => object.key.includes("/by-hash/"))
      .map((object) => object.key)
      .sort();

    await harness.renew(new Date(PUBLISHED_AT.getTime() + 6 * DAY_MS));

    expect(storedText(harness.objectStore, PACKAGES_KEY)).toBe(packagesBefore);
    expect([...new Set(harness.objectStore.objects
      .filter((object) => object.key.includes("/by-hash/"))
      .map((object) => object.key))].sort()).toEqual([...new Set(byHashBefore)].sort());
  });

  it("re-signs with a signature that still verifies", async () => {
    const harness = await createHarness();

    await harness.renew(new Date(PUBLISHED_AT.getTime() + 6 * DAY_MS));

    const release = storedText(harness.objectStore, RELEASE_KEY) ?? "";
    const inRelease = storedText(harness.objectStore, "repositories/debian-internal/dists/noble/InRelease") ?? "";
    const cleartext = await readCleartextMessage({ cleartextMessage: inRelease });

    expect(cleartext.getText()).toBe(release);
    const verified = await verify({
      message: cleartext,
      verificationKeys: await readKey({ armoredKey: harness.publicKeyArmored }),
    });
    await expect(verified.signatures[0]!.verified).resolves.toBe(true);
  });

  it("stays idle for a repository that never expires", async () => {
    const harness = await createHarness({ validityDays: undefined });
    const before = storedText(harness.objectStore, RELEASE_KEY);
    expect(before).not.toContain("Valid-Until");

    const result = await harness.renew(new Date(PUBLISHED_AT.getTime() + 3650 * DAY_MS));

    expect(result.refreshed).toEqual([]);
    expect(result.nextDueAt).toBeUndefined();
    expect(storedText(harness.objectStore, RELEASE_KEY)).toBe(before);
  });

  it("adds an expiry to a Release published before the setting existed", async () => {
    // Published with no validityDays, then configured to expire.
    const harness = await createHarness({ validityDays: undefined });
    expect(storedText(harness.objectStore, RELEASE_KEY)).not.toContain("Valid-Until");

    const state = new MemoryStateStore();
    const { service: signingKeys } = await createSigningKeys(state);
    const result = await renewAptReleaseSignatures({
      repository: repository({ validityDays: 10 }),
      objectStore: harness.objectStore,
      signingKeys,
      signer: new OpenPgpSigner(),
      now: new Date(PUBLISHED_AT.getTime() + DAY_MS),
    });

    expect(result.refreshed).toEqual(["noble"]);
    expect(storedText(harness.objectStore, RELEASE_KEY)).toContain("Valid-Until: Wed, 29 Jul 2026 00:00:00 GMT");
  });

  it("renews each suite on its own schedule", async () => {
    const harness = await createHarness({ suites: ["noble", "jammy"] });

    const result = await harness.renew(new Date(PUBLISHED_AT.getTime() + 6 * DAY_MS));

    // Only noble was ever published to, so jammy has no Release to renew.
    expect(result.refreshed).toEqual(["noble"]);
  });
});
