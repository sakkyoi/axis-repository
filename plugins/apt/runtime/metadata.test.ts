import { describe, expect, it } from "vitest";
import { ValidationError, type PublishArtifactsInput } from "@axis-repository/core";
import { buildAptRepositoryMetadata, parseAptRepositoryConfig, validateAptPublishArtifacts } from "./metadata";

const textDecoder = new TextDecoder();

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
    expect(metadata.packagesPath).toBe("repositories/debian-internal/dists/noble/main/binary-amd64/Packages");
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
    expect(metadata.packagesPath).toBe("repositories/debian-internal/dists/noble/main/binary-amd64/Packages");
    expect(metadata.packagesGzPath).toBe("repositories/debian-internal/dists/noble/main/binary-amd64/Packages.gz");
    expect(metadata.packages).toContain("Package: myapp\n");
    expect(metadata.packages).toContain("Filename: pool/main/myapp/myapp_1.2.3_amd64.deb\n");
    expect(metadata.packages).toContain(`SHA256: ${"a".repeat(64)}\n`);
    expect(metadata.packagesGz.byteLength).toBeGreaterThan(0);
    await expect(gunzip(metadata.packagesGz)).resolves.toBe(metadata.packages);
    expect(metadata.releasePath).toBe("repositories/debian-internal/dists/noble/Release");
    expect(metadata.release).toContain("Origin: debian-internal\n");
    expect(metadata.release).toContain("Label: debian-internal\n");
    expect(metadata.release).toContain("Suite: noble\n");
    expect(metadata.release).toContain("Codename: noble\n");
    expect(metadata.release).toContain("Date: Sat, 18 Jul 2026 00:10:00 GMT\n");
    expect(metadata.release).toContain("Architectures: amd64\n");
    expect(metadata.release).toContain("Components: main\n");
    expect(metadata.release).toContain("Acquire-By-Hash: no\n");
    expect(metadata.release).toContain("SHA256:\n");
    expect(metadata.release).toContain("SHA512:\n");

    const packagesBytes = new TextEncoder().encode(metadata.packages);
    expect(metadata.release).toContain(
      ` ${await digestHex("SHA-256", packagesBytes)} ${packagesBytes.byteLength} main/binary-amd64/Packages\n`,
    );
    expect(metadata.release).toContain(
      ` ${await digestHex("SHA-256", metadata.packagesGz)} ${metadata.packagesGz.byteLength} main/binary-amd64/Packages.gz\n`,
    );
    expect(metadata.release).toContain(
      ` ${await digestHex("SHA-512", packagesBytes)} ${packagesBytes.byteLength} main/binary-amd64/Packages\n`,
    );
    expect(metadata.release).toContain(
      ` ${await digestHex("SHA-512", metadata.packagesGz)} ${metadata.packagesGz.byteLength} main/binary-amd64/Packages.gz\n`,
    );
    expect(metadata.packageIndexes).toHaveLength(1);
    expect(metadata.packageIndexes[0]).toMatchObject({
      component: "main",
      architecture: "amd64",
      packagesPath: metadata.packagesPath,
      packagesGzPath: metadata.packagesGzPath,
      packages: metadata.packages,
    });
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

    for (const index of metadata.packageIndexes) {
      expect(metadata.release).toContain(`${index.relativePath}\n`);
      expect(metadata.release).toContain(`${index.relativeGzPath}\n`);
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
    for (const field of ["package", "version", "architecture", "component", "description", "maintainer"] as const) {
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
    ] as const) {
      const unsafe = input();
      unsafe.artifacts[0]!.artifact.metadata[field] = "safe\u0000unsafe";

      await expect(buildAptRepositoryMetadata(unsafe)).rejects.toThrow(
        `artifact metadata ${field} must not contain control characters`,
      );
    }
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
    };

    const metadata = await buildAptRepositoryMetadata(optional);

    expect(metadata.packages).toContain("Section: utils\n");
    expect(metadata.packages).toContain("Priority: optional\n");
    expect(metadata.packages).toContain("Homepage: https://example.com/myapp\n");
    expect(metadata.packages).toContain("Depends: libc6\n");
    expect(metadata.packages).toContain("Recommends: ca-certificates\n");
    expect(metadata.packages).toContain("Suggests: docs\n");
    expect(metadata.packages).toContain("Conflicts: old-myapp\n");
    expect(metadata.packages).toContain("Replaces: older-myapp\n");
    expect(metadata.packages).toContain("Provides: myapp-virtual\n");
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

    expect(orderedMetadata.packages).toBe(reversedMetadata.packages);
    expect(orderedMetadata.release).toBe(reversedMetadata.release);
    expect(orderedMetadata.packages.indexOf("Package: alpha\n")).toBeLessThan(
      orderedMetadata.packages.indexOf("Package: zeta\n"),
    );
  });
});
