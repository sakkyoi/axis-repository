import { describe, expect, it } from "vitest";
import { ValidationError, type PublishArtifactsInput } from "@axis-repository/core";
import { buildAptRepositoryMetadata, parseAptRepositoryConfig, validateAptPublishArtifacts, type AptRepositoryMetadata } from "./metadata";
import { md5Hex } from "../shared/md5";
import type { AptIndexFile } from "./index-files";
import type { AptPackageIndex } from "./packages";

const textDecoder = new TextDecoder();

function firstIndex(metadata: AptRepositoryMetadata): AptPackageIndex {
  const index = metadata.packageIndexes[0];
  if (!index) {
    throw new Error("expected at least one package index");
  }
  return index;
}

function indexFile(metadata: AptRepositoryMetadata, relativePath: string): AptIndexFile {
  const file = metadata.indexFiles.find((candidate) => candidate.relativePath === relativePath);
  if (!file) {
    throw new Error(`expected an index file at ${relativePath}`);
  }
  return file;
}

const input = (overrides: Partial<PublishArtifactsInput> = {}): PublishArtifactsInput => ({
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
      signingKeyIds: ["signing_key_prod"],
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
          depends: "libc6",
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
  ...overrides,
});

async function gunzip(bytes: Uint8Array): Promise<string> {
  if (typeof DecompressionStream !== "undefined") {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).text();
  }

  const dynamicImport = new Function("specifier", "return import(specifier)") as (
    specifier: string,
  ) => Promise<{ gunzipSync(input: Uint8Array): Uint8Array }>;
  const { gunzipSync } = await dynamicImport("node:zlib");
  return textDecoder.decode(gunzipSync(bytes));
}

async function digestHex(algorithm: "SHA-256" | "SHA-512", bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(algorithm, bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("APT metadata", () => {
  it("validates repository config", () => {
    expect(parseAptRepositoryConfig(input().repository)).toEqual({
      codename: "noble",
      components: ["main"],
      architectures: ["amd64"],
      signingKeyId: "signing_key_prod",
    });
  });

  it("accepts repository config without a fixed architecture allowlist", () => {
    const repository = input().repository;
    delete (repository.config.apt as Record<string, unknown>).architectures;

    expect(parseAptRepositoryConfig(repository)).toEqual({
      codename: "noble",
      components: ["main"],
      signingKeyId: "signing_key_prod",
    });
  });

  it("accepts repository config without a component allowlist", async () => {
    const repositoryInput = input();
    delete (repositoryInput.repository.config.apt as Record<string, unknown>).components;
    delete repositoryInput.artifacts[0]!.artifact.metadata.component;

    expect(parseAptRepositoryConfig(repositoryInput.repository)).toEqual({
      codename: "noble",
      architectures: ["amd64"],
      signingKeyId: "signing_key_prod",
    });

    const metadata = await buildAptRepositoryMetadata(repositoryInput);

    expect(metadata.config.components).toEqual(["main"]);
    expect(metadata.poolCopies[0]!.destinationKey).toBe("repositories/debian-internal/pool/main/myapp/myapp_1.2.3_amd64.deb");
    expect(firstIndex(metadata).relativePath).toBe("main/binary-amd64/Packages");
    expect(metadata.release).toContain("Components: main\n");
  });

  it("validates APT publish artifact request envelopes before uploads are verified", () => {
    const valid = input();
    expect(() =>
      validateAptPublishArtifacts({
        repository: valid.repository,
        artifacts: valid.artifacts.map((published) => published.artifact),
      }),
    ).not.toThrow();

    const missing = input();
    delete missing.artifacts[0]!.artifact.metadata.package;

    expect(() =>
      validateAptPublishArtifacts({
        repository: missing.repository,
        artifacts: missing.artifacts.map((published) => published.artifact),
      }),
    ).not.toThrow();

    const unsafe = input();
    unsafe.artifacts[0]!.artifact.filename = "../myapp_1.2.3_amd64.deb";
    expect(() =>
      validateAptPublishArtifacts({
        repository: unsafe.repository,
        artifacts: unsafe.artifacts.map((published) => published.artifact),
      }),
    ).toThrow("artifact filename is not safe");
  });

  it("rejects invalid repository config with exact messages", () => {
    for (const field of ["codename", "signingKeyId"] as const) {
      const invalid = input();
      delete (invalid.repository.config.apt as Record<string, unknown>)[field];

      expect(() => parseAptRepositoryConfig(invalid.repository)).toThrow(`config.apt.${field} is required`);
    }

    for (const field of ["components"] as const) {
      const empty = input();
      (empty.repository.config.apt as Record<string, unknown>)[field] = [];
      expect(() => parseAptRepositoryConfig(empty.repository)).toThrow(
        `config.apt.${field} must be a non-empty string array when provided`,
      );

      const nonString = input();
      (nonString.repository.config.apt as Record<string, unknown>)[field] = ["main", 1];
      expect(() => parseAptRepositoryConfig(nonString.repository)).toThrow(
        `config.apt.${field} must be a non-empty string array when provided`,
      );
    }

    for (const architectures of [[], ["amd64", 1]]) {
      const invalid = input();
      (invalid.repository.config.apt as Record<string, unknown>).architectures = architectures;
      expect(() => parseAptRepositoryConfig(invalid.repository)).toThrow(
        "config.apt.architectures must be a non-empty string array when provided",
      );
    }
  });

  it("rejects unsafe repository config path segments", () => {
    const badCodename = input();
    (badCodename.repository.config.apt as Record<string, unknown>).codename = "../noble";
    expect(() => parseAptRepositoryConfig(badCodename.repository)).toThrow(
      "config.apt.codename contains unsafe path characters",
    );

    const badComponent = input();
    (badComponent.repository.config.apt as Record<string, unknown>).components = ["main/../../pool"];
    expect(() => parseAptRepositoryConfig(badComponent.repository)).toThrow(
      "config.apt.components contains unsafe path characters",
    );

    const badArchitecture = input();
    (badArchitecture.repository.config.apt as Record<string, unknown>).architectures = ["amd64?debug"];
    expect(() => parseAptRepositoryConfig(badArchitecture.repository)).toThrow(
      "config.apt.architectures contains unsafe path characters",
    );
  });

  it("builds Packages, Packages.gz, Release, and pool copy plans", async () => {
    const metadata = await buildAptRepositoryMetadata(input());

    expect(metadata.poolCopies).toEqual([
      {
        sourceKey: "_staging/uploads/pub_1/upl_1/myapp_1.2.3_amd64.deb",
        destinationKey: "repositories/debian-internal/pool/main/myapp/myapp_1.2.3_amd64.deb",
        contentType: "application/vnd.debian.binary-package",
      },
    ]);
    const index = firstIndex(metadata);
    const packagesFile = indexFile(metadata, "main/binary-amd64/Packages");
    const packagesGz = indexFile(metadata, "main/binary-amd64/Packages.gz");
    expect(index.relativePath).toBe("main/binary-amd64/Packages");
    expect(index.packages).toContain("Package: myapp\n");
    expect(index.packages).toContain("Filename: pool/main/myapp/myapp_1.2.3_amd64.deb\n");
    expect(index.packages).toContain(`SHA256: ${"a".repeat(64)}\n`);
    expect(packagesFile.text).toBe(index.packages);
    expect(packagesGz.bytes.byteLength).toBeGreaterThan(0);
    await expect(gunzip(packagesGz.bytes)).resolves.toBe(index.packages);
    expect(metadata.releasePath).toBe("repositories/debian-internal/dists/noble/Release");
    expect(metadata.release).toContain("Origin: debian-internal\n");
    expect(metadata.release).toContain("Label: debian-internal\n");
    expect(metadata.release).toContain("Suite: noble\n");
    expect(metadata.release).toContain("Codename: noble\n");
    expect(metadata.release).toContain("Date: Sat, 18 Jul 2026 00:10:00 GMT\n");
    expect(metadata.release).toContain("Architectures: amd64\n");
    expect(metadata.release).toContain("Components: main\n");
    expect(metadata.release).toContain("Acquire-By-Hash: yes\n");
    expect(metadata.release).not.toContain("Valid-Until:");
    expect(metadata.release).not.toContain("NotAutomatic:");
    expect(metadata.release).toContain("MD5Sum:\n");
    expect(metadata.release).toContain("SHA256:\n");
    expect(metadata.release).toContain("SHA512:\n");
    expect(metadata.release).toContain(
      ` ${md5Hex(packagesFile.bytes)} ${packagesFile.bytes.byteLength} main/binary-amd64/Packages\n`,
    );

    const packagesBytes = packagesFile.bytes;
    expect(metadata.release).toContain(
      ` ${await digestHex("SHA-256", packagesBytes)} ${packagesBytes.byteLength} main/binary-amd64/Packages\n`,
    );
    expect(metadata.release).toContain(
      ` ${await digestHex("SHA-256", packagesGz.bytes)} ${packagesGz.bytes.byteLength} main/binary-amd64/Packages.gz\n`,
    );
    expect(metadata.release).toContain(
      ` ${await digestHex("SHA-512", packagesBytes)} ${packagesBytes.byteLength} main/binary-amd64/Packages\n`,
    );
    expect(metadata.release).toContain(
      ` ${await digestHex("SHA-512", packagesGz.bytes)} ${packagesGz.bytes.byteLength} main/binary-amd64/Packages.gz\n`,
    );
    expect(metadata.packageIndexes).toHaveLength(1);
    expect(index).toMatchObject({ component: "main", architecture: "amd64" });
    expect(metadata.indexFiles.map((file) => file.relativePath)).toEqual([
      "main/binary-amd64/Packages",
      "main/binary-amd64/Packages.gz",
      "main/i18n/Translation-en",
      "main/i18n/Translation-en.gz",
    ]);
  });

  it("discovers repository architectures from uploaded package metadata when no allowlist is configured", async () => {
    const discovered = input();
    delete (discovered.repository.config.apt as Record<string, unknown>).architectures;
    discovered.artifacts[0]!.artifact.filename = "myapp_1.2.3_arm64.deb";
    discovered.artifacts[0]!.artifact.metadata.architecture = "arm64";

    const metadata = await buildAptRepositoryMetadata(discovered);

    expect(metadata.config.architectures).toEqual(["arm64"]);
    expect(metadata.release).toContain("Architectures: arm64\n");
    expect(metadata.packageIndexes.map((index) => index.relativePath)).toEqual([
      "main/binary-arm64/Packages",
    ]);
  });

  it("uses binary-all when architecture all is the only discovered architecture", async () => {
    const discovered = input();
    delete (discovered.repository.config.apt as Record<string, unknown>).architectures;
    discovered.artifacts[0]!.artifact.filename = "portable_1.0.0_all.deb";
    discovered.artifacts[0]!.artifact.metadata.package = "portable";
    discovered.artifacts[0]!.artifact.metadata.version = "1.0.0";
    discovered.artifacts[0]!.artifact.metadata.architecture = "all";

    const metadata = await buildAptRepositoryMetadata(discovered);

    expect(metadata.config.architectures).toEqual(["all"]);
    expect(metadata.release).toContain("Architectures: all\n");
    expect(metadata.packageIndexes.map((index) => index.relativePath)).toEqual([
      "main/binary-all/Packages",
    ]);
  });

  it("partitions Packages indexes by component and architecture and expands architecture all", async () => {
    const multi = input();
    multi.repository.config = {
      apt: {
        codename: "noble",
        components: ["main", "contrib"],
        architectures: ["amd64", "arm64"],
        signingKeyId: "signing_key_prod",
      },
    };
    multi.artifacts = [
      {
        ...multi.artifacts[0]!,
        artifact: {
          ...multi.artifacts[0]!.artifact,
          filename: "portable_1.0.0_all.deb",
          metadata: {
            ...multi.artifacts[0]!.artifact.metadata,
            package: "portable",
            version: "1.0.0",
            architecture: "all",
          },
        },
      },
      {
        ...multi.artifacts[0]!,
        artifact: {
          ...multi.artifacts[0]!.artifact,
          filename: "worker_2.0.0_arm64.deb",
          metadata: {
            ...multi.artifacts[0]!.artifact.metadata,
            package: "worker",
            version: "2.0.0",
            architecture: "arm64",
          },
        },
        upload: {
          ...multi.artifacts[0]!.upload,
          objectKey: "_staging/uploads/pub_1/upl_2/worker_2.0.0_arm64.deb",
        },
        verified: {
          ...multi.artifacts[0]!.verified,
          objectKey: "_staging/uploads/pub_1/upl_2/worker_2.0.0_arm64.deb",
          sha256: "b".repeat(64),
        },
      },
      {
        ...multi.artifacts[0]!,
        artifact: {
          ...multi.artifacts[0]!.artifact,
          filename: "addon_3.0.0_amd64.deb",
          metadata: {
            ...multi.artifacts[0]!.artifact.metadata,
            package: "addon",
            version: "3.0.0",
            architecture: "amd64",
            component: "contrib",
          },
        },
        upload: {
          ...multi.artifacts[0]!.upload,
          objectKey: "_staging/uploads/pub_1/upl_3/addon_3.0.0_amd64.deb",
        },
        verified: {
          ...multi.artifacts[0]!.verified,
          objectKey: "_staging/uploads/pub_1/upl_3/addon_3.0.0_amd64.deb",
          sha256: "c".repeat(64),
        },
      },
    ];

    const metadata = await buildAptRepositoryMetadata(multi);
    const indexesByPath = new Map(metadata.packageIndexes.map((index) => [index.relativePath, index]));

    expect([...indexesByPath.keys()]).toEqual([
      "main/binary-amd64/Packages",
      "main/binary-arm64/Packages",
      "contrib/binary-amd64/Packages",
    ]);
    expect(indexesByPath.get("main/binary-amd64/Packages")!.packages).toContain("Package: portable\n");
    expect(indexesByPath.get("main/binary-amd64/Packages")!.packages).not.toContain("Package: worker\n");
    expect(indexesByPath.get("main/binary-arm64/Packages")!.packages).toContain("Package: portable\n");
    expect(indexesByPath.get("main/binary-arm64/Packages")!.packages).toContain("Package: worker\n");
    expect(indexesByPath.get("contrib/binary-amd64/Packages")!.packages).toContain("Package: addon\n");

    for (const file of metadata.indexFiles) {
      expect(metadata.release).toContain(` ${file.relativePath}\n`);
    }
  });

  it("rejects artifacts outside configured components and architectures", async () => {
    const badComponent = input();
    badComponent.artifacts[0]!.artifact.metadata.component = "contrib";
    await expect(buildAptRepositoryMetadata(badComponent)).rejects.toBeInstanceOf(ValidationError);

    const badArchitecture = input();
    badArchitecture.artifacts[0]!.artifact.metadata.architecture = "arm64";
    await expect(buildAptRepositoryMetadata(badArchitecture)).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects unsafe artifact path values and filenames", async () => {
    const badRepositoryName = input();
    badRepositoryName.repository.name = "../debian-internal";
    await expect(buildAptRepositoryMetadata(badRepositoryName)).rejects.toThrow(
      "repository name contains unsafe path characters",
    );

    const badPackage = input();
    badPackage.artifacts[0]!.artifact.metadata.package = "../myapp";
    await expect(buildAptRepositoryMetadata(badPackage)).rejects.toThrow(
      "artifact metadata package contains unsafe path characters",
    );

    for (const filename of [
      "../myapp_1.2.3_amd64.deb",
      "pool/myapp_1.2.3_amd64.deb",
      ".",
      "..",
      "myapp_1.2.3_amd64.deb?download=1",
      "myapp_1.2.3_amd64.deb#fragment",
      "myapp_1.2.3_amd64.txt",
    ]) {
      const badFilename = input();
      badFilename.artifacts[0]!.artifact.filename = filename;

      await expect(buildAptRepositoryMetadata(badFilename)).rejects.toThrow("artifact filename is not safe");
    }
  });

  it("rejects missing required APT artifact metadata", async () => {
    for (const field of ["package", "version", "architecture", "description", "maintainer"] as const) {
      const missing = input();
      delete missing.artifacts[0]!.artifact.metadata[field];

      await expect(buildAptRepositoryMetadata(missing)).rejects.toThrow(`artifact metadata ${field} is required`);
    }
  });

  it("rejects control characters in emitted APT metadata fields", async () => {
    for (const field of ["package", "version", "architecture", "component", "maintainer"] as const) {
      const unsafe = input();
      unsafe.artifacts[0]!.artifact.metadata[field] = `${unsafe.artifacts[0]!.artifact.metadata[field]}\nInjected: yes`;

      await expect(buildAptRepositoryMetadata(unsafe)).rejects.toThrow(
        `artifact metadata ${field} must not contain control characters`,
      );
    }

    for (const field of [
      "section",
      "priority",
      "homepage",
      "depends",
      "recommends",
      "suggests",
      "conflicts",
      "replaces",
      "provides",
      "source",
      "installedSize",
      "multiArch",
      "essential",
      "preDepends",
      "enhances",
      "breaks",
      "builtUsing",
      "origin",
      "bugs",
      "tag",
    ] as const) {
      const unsafe = input();
      unsafe.artifacts[0]!.artifact.metadata[field] = "safe\u0000unsafe";

      await expect(buildAptRepositoryMetadata(unsafe)).rejects.toThrow(
        `artifact metadata ${field} must not contain control characters`,
      );
    }
  });

  it("writes the optional Release identity, expiry and pinning fields", async () => {
    const configured = input();
    Object.assign(configured.repository.config.apt as Record<string, unknown>, {
      origin: "Example Ltd",
      label: "Example internal packages",
      suite: "stable",
      description: "Internal builds for Example Ltd",
      validityDays: 7,
      notAutomatic: true,
      butAutomaticUpgrades: true,
      acquireByHash: false,
    });

    const metadata = await buildAptRepositoryMetadata(configured);

    expect(metadata.release).toContain("Origin: Example Ltd\n");
    expect(metadata.release).toContain("Label: Example internal packages\n");
    expect(metadata.release).toContain("Suite: stable\n");
    expect(metadata.release).toContain("Codename: noble\n");
    expect(metadata.release).toContain("Description: Internal builds for Example Ltd\n");
    expect(metadata.release).toContain("Date: Sat, 18 Jul 2026 00:10:00 GMT\n");
    expect(metadata.release).toContain("Valid-Until: Sat, 25 Jul 2026 00:10:00 GMT\n");
    expect(metadata.release).toContain("NotAutomatic: yes\n");
    expect(metadata.release).toContain("ButAutomaticUpgrades: yes\n");
    expect(metadata.release).toContain("Acquire-By-Hash: no\n");
  });

  it("rejects Release settings that apt would silently ignore or that could inject a field", () => {
    const orphanPin = input();
    (orphanPin.repository.config.apt as Record<string, unknown>).butAutomaticUpgrades = true;
    expect(() => parseAptRepositoryConfig(orphanPin.repository)).toThrow(
      "config.apt.butAutomaticUpgrades requires config.apt.notAutomatic",
    );

    for (const field of ["origin", "label", "suite", "description"] as const) {
      const injected = input();
      (injected.repository.config.apt as Record<string, unknown>)[field] = "Example\nValid-Until: never";
      expect(() => parseAptRepositoryConfig(injected.repository)).toThrow(
        `config.apt.${field} must not contain control characters`,
      );
    }

    for (const validityDays of [0, -1, 1.5, "7"]) {
      const invalid = input();
      (invalid.repository.config.apt as Record<string, unknown>).validityDays = validityDays;
      expect(() => parseAptRepositoryConfig(invalid.repository)).toThrow(
        "config.apt.validityDays must be a positive whole number when provided",
      );
    }
  });

  it("keeps a long description across lines but refuses one that starts a new field", async () => {
    const injected = input();
    injected.artifacts[0]!.artifact.metadata.description = "Example package\nInjected: yes";
    await expect(buildAptRepositoryMetadata(injected)).rejects.toThrow(
      "artifact metadata description continuation lines must start with a space",
    );

    const long = input();
    long.artifacts[0]!.artifact.metadata.description = "Example package\n This is the long form.\n .\n Second paragraph.";

    const metadata = await buildAptRepositoryMetadata(long);

    expect(firstIndex(metadata).packages).toContain(
      "Description: Example package\n This is the long form.\n .\n Second paragraph.\n",
    );
  });

  it("maps optional APT artifact metadata fields to Debian field casing", async () => {
    const optional = input();
    optional.artifacts[0]!.artifact.metadata = {
      ...optional.artifacts[0]!.artifact.metadata,
      section: "utils",
      priority: "optional",
      homepage: "https://example.com/myapp",
      depends: "libc6",
      recommends: "ca-certificates",
      suggests: "docs",
      conflicts: "old-myapp",
      replaces: "older-myapp",
      provides: "myapp-virtual",
      source: "myapp-src",
      installedSize: "2048",
      multiArch: "foreign",
      essential: "no",
      preDepends: "libc6 (>= 2.34)",
      enhances: "myapp-extras",
      breaks: "myapp-plugin (<< 2.0)",
      builtUsing: "openssl (= 3.0.2-0ubuntu1)",
    };

    const metadata = await buildAptRepositoryMetadata(optional);

    const packages = firstIndex(metadata).packages;
    expect(packages).toContain("Section: utils\n");
    expect(packages).toContain("Priority: optional\n");
    expect(packages).toContain("Homepage: https://example.com/myapp\n");
    expect(packages).toContain("Depends: libc6\n");
    expect(packages).toContain("Recommends: ca-certificates\n");
    expect(packages).toContain("Suggests: docs\n");
    expect(packages).toContain("Conflicts: old-myapp\n");
    expect(packages).toContain("Replaces: older-myapp\n");
    expect(packages).toContain("Provides: myapp-virtual\n");
    // Without these, apt resolves dependencies wrongly rather than not at all:
    // it unpacks in the wrong order, refuses to displace a conflicting
    // package, or cannot satisfy a foreign-architecture dependency.
    expect(packages).toContain("Source: myapp-src\n");
    expect(packages).toContain("Installed-Size: 2048\n");
    expect(packages).toContain("Multi-Arch: foreign\n");
    expect(packages).toContain("Essential: no\n");
    expect(packages).toContain("Pre-Depends: libc6 (>= 2.34)\n");
    expect(packages).toContain("Enhances: myapp-extras\n");
    expect(packages).toContain("Breaks: myapp-plugin (<< 2.0)\n");
    expect(packages).toContain("Built-Using: openssl (= 3.0.2-0ubuntu1)\n");
  });

  it("sorts package stanzas deterministically independent of artifact input order", async () => {
    const ordered = input();
    ordered.artifacts = [
      {
        ...ordered.artifacts[0]!,
        artifact: {
          ...ordered.artifacts[0]!.artifact,
          filename: "zeta_2.0.0_amd64.deb",
          metadata: {
            ...ordered.artifacts[0]!.artifact.metadata,
            package: "zeta",
            version: "2.0.0",
          },
        },
        upload: {
          ...ordered.artifacts[0]!.upload,
          objectKey: "_staging/uploads/pub_1/upl_z/zeta_2.0.0_amd64.deb",
        },
        verified: {
          ...ordered.artifacts[0]!.verified,
          objectKey: "_staging/uploads/pub_1/upl_z/zeta_2.0.0_amd64.deb",
          sha256: "b".repeat(64),
        },
      },
      {
        ...ordered.artifacts[0]!,
        artifact: {
          ...ordered.artifacts[0]!.artifact,
          filename: "alpha_1.0.0_amd64.deb",
          metadata: {
            ...ordered.artifacts[0]!.artifact.metadata,
            package: "alpha",
            version: "1.0.0",
          },
        },
        upload: {
          ...ordered.artifacts[0]!.upload,
          objectKey: "_staging/uploads/pub_1/upl_a/alpha_1.0.0_amd64.deb",
        },
        verified: {
          ...ordered.artifacts[0]!.verified,
          objectKey: "_staging/uploads/pub_1/upl_a/alpha_1.0.0_amd64.deb",
          sha256: "c".repeat(64),
        },
      },
    ];
    const reversed = {
      ...ordered,
      artifacts: [...ordered.artifacts].reverse(),
    };

    const orderedMetadata = await buildAptRepositoryMetadata(ordered);
    const reversedMetadata = await buildAptRepositoryMetadata(reversed);

    const orderedPackages = firstIndex(orderedMetadata).packages;
    expect(orderedPackages).toBe(firstIndex(reversedMetadata).packages);
    expect(orderedMetadata.release).toBe(reversedMetadata.release);
    expect(orderedPackages.indexOf("Package: alpha\n")).toBeLessThan(
      orderedPackages.indexOf("Package: zeta\n"),
    );
  });
});
