import {
  MemoryStateStore,
  ValidationError,
  type Repository,
  type RepositoryArtifactRecord,
  type RepositoryArtifactStore,
  type TokenPrincipal,
} from "@axis-repository/core";
import {
  dispatchRepositoryAdminResource,
  dispatchRepositoryClientHelper,
  objectBytes,
  type RepositorySigningKeyCapability,
} from "@axis-repository/runtime-cloudflare/plugin-runtime";
import { assertRuntimePluginManifestParity, MemoryRepositoryObjectStore } from "@axis-repository/runtime-cloudflare/plugin-runtime/testing";
import { describe, expect, it } from "vitest";
import { aptPluginManifest } from "../manifest";
import { createAptGroupPlugin, createAptPlugin, createAptProxyPlugin } from "./runtime";

function repository(config: Record<string, unknown> = {
  apt: {
    codename: "noble",
    components: ["main"],
    architectures: ["amd64"],
    signing: { mode: "axis", signingKeyId: "signing_key_prod" },
  },
}): Repository {
  return {
    id: "repo_1",
    name: "debian-internal",
    ecosystem: "apt",
    kind: "hosted",
    visibility: "private",
    config,
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
  };
}

function proxyRepository(config: Record<string, unknown> = {
  apt: {
    upstreamUrl: "https://deb.example/debian/",
    signing: { mode: "upstream" },
    codename: "bookworm",
  },
}): Repository {
  return {
    ...repository(config),
    name: "debian-proxy",
    kind: "proxy",
  };
}

function groupRepository(config: Record<string, unknown> = {
  apt: {
    codename: "bookworm",
    components: ["main"],
    members: ["debian-internal", "debian-proxy"],
    signing: { mode: "axis", signingKeyId: "signing_key_group" },
  },
}): Repository {
  return {
    ...repository(config),
    name: "debian-group",
    kind: "group",
  };
}

function unsignedGroupRepository(): Repository {
  return groupRepository({
    apt: {
      codename: "bookworm",
      components: ["main"],
      members: ["debian-internal", "debian-proxy"],
      signing: { mode: "unsigned" },
    },
  });
}

const principal: TokenPrincipal = {
  tokenId: "ptok_1",
  name: "ci",
  permissions: ["publish"],
  repositories: ["debian-internal"],
  ecosystemScopes: {},
  signingKeyIds: ["signing_key_prod"],
};

const defaultSigningKey = {
  id: "signing_key_prod",
  repositoryName: "debian-internal",
  name: "release",
  publicKeyArmored: "-----BEGIN PGP PUBLIC KEY BLOCK-----",
  fingerprint: "FINGERPRINT",
  keyId: "KEYID",
  createdAt: "2026-07-22T00:00:00.000Z",
  revokedAt: null,
};

function repositoryArtifact(overrides: Partial<RepositoryArtifactRecord> = {}): RepositoryArtifactRecord {
  return {
    id: "artifact_alpha",
    repositoryName: "debian-internal",
    ecosystem: "apt",
    identity: "apt:main:alpha:1.0.0:amd64",
    family: "apt:main:alpha",
    name: "alpha",
    version: "1.0.0",
    summary: "alpha 1.0.0 amd64",
    primaryObjectKey: "repositories/debian-internal/pool/main/alpha/alpha_1.0.0_amd64.deb",
    objectKeys: ["repositories/debian-internal/pool/main/alpha/alpha_1.0.0_amd64.deb"],
    metadata: {
      package: "alpha",
      version: "1.0.0",
      architecture: "amd64",
      component: "main",
      filename: "pool/main/alpha/alpha_1.0.0_amd64.deb",
    },
    publishedAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
    ...overrides,
  };
}

function signingKeys(overrides: Partial<RepositorySigningKeyCapability> = {}): RepositorySigningKeyCapability {
  return {
    listForRepository: async () => [defaultSigningKey],
    create: async () => defaultSigningKey,
    generate: async () => defaultSigningKey,
    getPublicKey: async () => defaultSigningKey,
    getActivePrivateKey: async (id) => ({
      id,
      repositoryName: "debian-internal",
      privateKeyArmored: "-----BEGIN PGP PRIVATE KEY BLOCK-----",
      passphrase: "passphrase",
      fingerprint: "FINGERPRINT",
      keyId: "KEYID",
    }),
    revoke: async () => ({ ...defaultSigningKey, revokedAt: "2026-07-23T00:00:00.000Z" }),
    ...overrides,
  };
}

function createTestAptPlugin(options: Partial<RepositorySigningKeyCapability> = {}) {
  return createAptPlugin({
    publisher: { publish: async () => ({ publishedAt: "2026-07-18T00:00:00.000Z", objects: [] }) },
    signingKeys: signingKeys(options),
    signer: {
      clearSign: async () => "-----BEGIN PGP SIGNED MESSAGE-----\n",
      detachSign: async () => "-----BEGIN PGP SIGNATURE-----\n",
    },
  });
}

function createTestAptGroupPlugin(options: Partial<RepositorySigningKeyCapability> = {}) {
  return createAptGroupPlugin({
    signingKeys: signingKeys(options),
    signer: {
      clearSign: async () => "-----BEGIN PGP SIGNED MESSAGE-----\n",
      detachSign: async () => "-----BEGIN PGP SIGNATURE-----\n",
    },
  });
}

function repositoryScopedObjectStore(
  objectStore: MemoryRepositoryObjectStore,
  repositoryName: string,
): MemoryRepositoryObjectStore {
  const prefix = `repositories/${repositoryName}/`;
  return {
    ...objectStore,
    putText: async (key, value, contentType) => {
      if (!key.startsWith(prefix)) {
        throw new ValidationError(`Object key is outside repository ${repositoryName}: ${key}`);
      }
      await objectStore.putText(key, value, contentType);
    },
  } as MemoryRepositoryObjectStore;
}

function repositoryLookup(repositories: Repository[]) {
  return {
    list: async () => repositories,
    getByName: async (name: string) => {
      const found = repositories.find((repository) => repository.name === name);
      if (!found) {
        throw new ValidationError(`Repository not found: ${name}`);
      }
      return found;
    },
  };
}

function repositoryArtifactStore(recordsByRepository: Record<string, RepositoryArtifactRecord[]>): RepositoryArtifactStore {
  return {
    getById: async (id) =>
      Object.values(recordsByRepository).flat().find((artifact) => artifact.id === id) ?? null,
    countByRepository: async (repositoryName) => recordsByRepository[repositoryName]?.length ?? 0,
    listByRepository: async (repositoryName) => recordsByRepository[repositoryName] ?? [],
    listFamiliesByRepositoryPage: async () => ({ records: [], totalFamilies: 0, totalArtifacts: 0 }),
    listByRepositoryPage: async (repositoryName, page) => {
      const records = recordsByRepository[repositoryName] ?? [];
      return {
        records: records.slice(page.offset, page.offset + page.limit),
        total: records.length,
      };
    },
    listByRepositoryFamily: async (repositoryName, family) =>
      (recordsByRepository[repositoryName] ?? []).filter((artifact) => artifact.family === family),
    upsert: async () => {},
    upsertMany: async () => {},
    replaceByRepository: async () => {},
  };
}

async function storedText(objectStore: MemoryRepositoryObjectStore, key: string): Promise<string | undefined> {
  const object = await objectStore.getObject(key);
  return object ? new TextDecoder().decode(await objectBytes(object)) : undefined;
}

describe("APT plugin lifecycle", () => {
  it("validates repository config", () => {
    const plugin = createTestAptPlugin();

    expect(() =>
      plugin.validateRepositoryConfig({
        ecosystem: "apt",
        config: repository().config,
      }),
    ).not.toThrow();
    expect(() =>
      plugin.validateRepositoryConfig({
        ecosystem: "apt",
        config: { apt: { components: ["main"], architectures: ["amd64"] } },
      }),
    ).toThrow("config.apt.codename is required");
  });

  it("authorizes publish tokens against the repository signing key", () => {
    const plugin = createTestAptPlugin();

    expect(() =>
      plugin.publish.authorize({
        repository: repository(),
        principal,
        artifacts: [],
      }),
    ).not.toThrow();
    expect(() =>
      plugin.publish.authorize({
        repository: repository(),
        principal: { ...principal, signingKeyIds: [] },
        artifacts: [],
      }),
    ).toThrow(new ValidationError("Publish token is not scoped to the repository signing key"));
  });

  it("generates a signing key during repository creation", async () => {
    const calls: unknown[] = [];
    const plugin = createTestAptPlugin({
      generate: async (input) => {
        calls.push(input);
        return { ...defaultSigningKey, id: "signing_key_generated" };
      },
    });

    const result = await plugin.create?.provision({
      repositoryName: "debian-internal",
      ecosystem: "apt",
      visibility: "private",
      config: { apt: { codename: "noble", components: ["main"], architectures: ["amd64"] } },
      provisioning: {
        apt: {
          signingKey: {
            mode: "generate",
            name: "release",
            userIdName: "Axis Repository",
            userIdEmail: "axis@example.test",
          },
        },
      },
    });

    expect(result).toEqual({ configPatch: { apt: { signing: { mode: "axis", signingKeyId: "signing_key_generated" } } } });
    expect(calls).toEqual([
      {
        repositoryName: "debian-internal",
        name: "release",
        userIdName: "Axis Repository",
        userIdEmail: "axis@example.test",
      },
    ]);
  });

  it("imports a signing key during repository creation", async () => {
    const calls: unknown[] = [];
    const plugin = createTestAptPlugin({
      create: async (input) => {
        calls.push(input);
        return { ...defaultSigningKey, id: "signing_key_imported" };
      },
    });

    const result = await plugin.create?.provision({
      repositoryName: "debian-internal",
      ecosystem: "apt",
      visibility: "private",
      config: { apt: { codename: "noble", components: ["main"], architectures: ["amd64"] } },
      provisioning: {
        apt: {
          signingKey: {
            mode: "import",
            name: "release",
            privateKeyArmored: "-----BEGIN PGP PRIVATE KEY BLOCK-----",
            passphrase: "passphrase",
          },
        },
      },
    });

    expect(result).toEqual({ configPatch: { apt: { signing: { mode: "axis", signingKeyId: "signing_key_imported" } } } });
    expect(calls).toEqual([
      {
        repositoryName: "debian-internal",
        name: "release",
        privateKeyArmored: "-----BEGIN PGP PRIVATE KEY BLOCK-----",
        passphrase: "passphrase",
      },
    ]);
  });

  it("attaches an existing signing key during repository creation", async () => {
    const plugin = createTestAptPlugin({
      getPublicKey: async () => defaultSigningKey,
    });

    await expect(plugin.create?.provision({
      repositoryName: "debian-internal",
      ecosystem: "apt",
      visibility: "private",
      config: { apt: { codename: "noble", components: ["main"], architectures: ["amd64"] } },
      provisioning: {
        apt: {
          signingKey: {
            mode: "existing",
            signingKeyId: "signing_key_prod",
          },
        },
      },
    })).resolves.toEqual({ configPatch: { apt: { signing: { mode: "axis", signingKeyId: "signing_key_prod" } } } });
  });

  it("serves APT client helpers from plugin policy", async () => {
    const plugin = createTestAptPlugin({
      getPublicKey: async () => ({
        ...defaultSigningKey,
        publicKeyArmored: "-----BEGIN PGP PUBLIC KEY BLOCK-----",
      }),
    });

    expect(plugin.clientHelpers?.namespace).toBe("apt");
    expect(plugin.clientHelpers?.actions).toEqual([
      expect.objectContaining({
        name: "key.gpg",
        label: "key.gpg",
        responseKind: "text",
        defaultOpen: false,
        public: true,
        handle: expect.any(Function),
      }),
      expect.objectContaining({
        name: "source",
        label: "source",
        responseKind: "json",
        defaultOpen: false,
        public: true,
        handle: expect.any(Function),
      }),
      expect.objectContaining({
        name: "install",
        label: "install",
        responseKind: "shell",
        defaultOpen: true,
        public: true,
        handle: expect.any(Function),
      }),
    ]);
    expect(plugin.clientHelpers?.actions.find((action) => action.name === "key.gpg")?.public).toBe(true);
    const keyResponse = await dispatchRepositoryClientHelper(plugin.clientHelpers!, {
      repository: repository(),
      action: "key.gpg",
      origin: "https://axis.example",
    });
    const installResponse = await dispatchRepositoryClientHelper(plugin.clientHelpers!, {
      repository: repository(),
      action: "install",
      origin: "https://axis.example",
    });

    expect(keyResponse?.headers.get("content-type")).toBe("application/pgp-keys");
    await expect(keyResponse?.text()).resolves.toBe("-----BEGIN PGP PUBLIC KEY BLOCK-----");
    await expect(installResponse?.json()).resolves.toMatchObject({
      repository: "debian-internal",
      script: expect.stringContaining("# Install the repository signing key."),
    });
  });

  it("serves APT signing keys from plugin admin resources", async () => {
    const calls: Array<{ method: string; input?: unknown }> = [];
    const plugin = createTestAptPlugin({
      listForRepository: async (repositoryName: string) => {
        calls.push({ method: "listForRepository", input: repositoryName });
        return [defaultSigningKey];
      },
      generate: async (input: unknown) => {
        calls.push({ method: "generate", input });
        return defaultSigningKey;
      },
      create: async (input: unknown) => {
        calls.push({ method: "create", input });
        return defaultSigningKey;
      },
      getPublicKey: async (id: string) => {
        calls.push({ method: "getPublicKey", input: id });
        return defaultSigningKey;
      },
      revoke: async (id: string) => {
        calls.push({ method: "revoke", input: id });
        return { ...defaultSigningKey, revokedAt: "2026-07-23T00:00:00.000Z" };
      },
    });
    const services = {};

    expect(plugin.adminResources?.namespace).toBe("apt");
    expect(plugin.adminResources?.routes.map(({ handle: _handle, ...route }) => route)).toEqual(
      aptPluginManifest.adminResources?.routes,
    );
    await expect(dispatchRepositoryAdminResource(plugin.adminResources!, {
      repositoryName: "debian-internal",
      repository: repository(),
      request: new Request("https://axis.example/admin/repositories/debian-internal/apt/signing-keys"),
      path: ["signing-keys"],
      services,
    }).then((response) => response.json())).resolves.toEqual({ signingKeys: [defaultSigningKey] });
    await expect(dispatchRepositoryAdminResource(plugin.adminResources!, {
      repositoryName: "debian-internal",
      repository: repository(),
      request: new Request("https://axis.example/admin/repositories/debian-internal/apt/signing-keys/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "release",
          userIdName: "Axis Repository",
          userIdEmail: "axis@example.test",
        }),
      }),
      path: ["signing-keys", "generate"],
      services,
    }).then((response) => response.status)).resolves.toBe(201);
    await expect(dispatchRepositoryAdminResource(plugin.adminResources!, {
      repositoryName: "debian-internal",
      repository: repository(),
      request: new Request("https://axis.example/admin/repositories/debian-internal/apt/signing-keys/signing_key_prod/revoke", {
        method: "POST",
      }),
      path: ["signing-keys", "signing_key_prod", "revoke"],
      services,
    }).then((response) => response.json())).resolves.toMatchObject({ revokedAt: "2026-07-23T00:00:00.000Z" });

    expect(calls).toEqual([
      { method: "listForRepository", input: "debian-internal" },
      {
        method: "generate",
        input: {
          repositoryName: "debian-internal",
          name: "release",
          userIdName: "Axis Repository",
          userIdEmail: "axis@example.test",
        },
      },
      { method: "getPublicKey", input: "signing_key_prod" },
      { method: "revoke", input: "signing_key_prod" },
    ]);
  });

  it("keeps runtime metadata aligned with the shared plugin manifest", () => {
    assertRuntimePluginManifestParity({
      manifest: aptPluginManifest,
      plugin: createTestAptPlugin(),
    });
  });
});

describe("APT group plugin lifecycle", () => {
  it("validates APT group members", async () => {
    const plugin = createTestAptGroupPlugin();
    const validate = (input: Parameters<typeof plugin.validateRepositoryConfig>[0]) =>
      Promise.resolve().then(() => plugin.validateRepositoryConfig(input));
    const lookup = repositoryLookup([
      repository(),
      proxyRepository(),
      groupRepository(),
    ]);

    await expect(validate({
      ecosystem: "apt",
      repositoryName: "debian-group",
      config: groupRepository().config,
      repositories: lookup,
    })).resolves.toBeUndefined();

    await expect(validate({
      ecosystem: "apt",
      repositoryName: "debian-group",
      config: { apt: { codename: "bookworm", members: [], signing: { mode: "axis", signingKeyId: "signing_key_group" } } },
      repositories: lookup,
    })).rejects.toThrow("config.apt.members must contain at least one repository");

    await expect(validate({
      ecosystem: "apt",
      repositoryName: "debian-group",
      config: { apt: { codename: "bookworm", members: ["debian-group"], signing: { mode: "axis", signingKeyId: "signing_key_group" } } },
      repositories: lookup,
    })).rejects.toThrow("config.apt.members cannot include the group repository itself");
  });

  it("rejects non-APT or non-hosted/proxy APT group members", async () => {
    const plugin = createTestAptGroupPlugin();
    const validate = (input: Parameters<typeof plugin.validateRepositoryConfig>[0]) =>
      Promise.resolve().then(() => plugin.validateRepositoryConfig(input));
    const lookup = repositoryLookup([
      { ...repository(), name: "python-internal", ecosystem: "pypi" },
      groupRepository({ apt: { codename: "bookworm", members: ["debian-internal"], signing: { mode: "axis", signingKeyId: "signing_key_nested" } } }),
    ]);

    await expect(validate({
      ecosystem: "apt",
      repositoryName: "debian-group",
      config: { apt: { codename: "bookworm", members: ["python-internal"], signing: { mode: "axis", signingKeyId: "signing_key_group" } } },
      repositories: lookup,
    })).rejects.toThrow("config.apt.members must reference APT repositories: python-internal");

    await expect(validate({
      ecosystem: "apt",
      repositoryName: "debian-group",
      config: { apt: { codename: "bookworm", members: ["debian-nested-group"], signing: { mode: "axis", signingKeyId: "signing_key_group" } } },
      repositories: repositoryLookup([{ ...groupRepository({ apt: { codename: "bookworm", members: ["debian-internal"], signing: { mode: "axis", signingKeyId: "signing_key_nested" } } }), name: "debian-nested-group" }]),
    })).rejects.toThrow("config.apt.members must reference hosted or proxy repositories: debian-nested-group");
  });

  it("serves APT group pool paths from the first member that answers", async () => {
    const plugin = createTestAptGroupPlugin();
    const calls: string[] = [];
    const response = await plugin.serveRepositoryPath!({
      repository: groupRepository(),
      request: new Request("https://axis.example/repositories/debian-group/pool/main/alpha/alpha_1.0.0_amd64.deb"),
      relativePath: "pool/main/alpha/alpha_1.0.0_amd64.deb",
      repositories: repositoryLookup([repository(), proxyRepository()]),
      serveRepositoryPath: async ({ repository }) => {
        calls.push(repository.name);
        return repository.name === "debian-internal"
          ? new Response("missing", { status: 404 })
          : new Response("proxy release", { status: 200 });
      },
    });

    await expect(response?.text()).resolves.toBe("proxy release");
    expect(calls).toEqual(["debian-internal", "debian-proxy"]);
    expect(plugin.canServeRepositoryPath({ relativePath: "dists/noble/Release" })).toBe(true);
    expect(plugin.canServeRepositoryPath({ relativePath: "pool/main/a/alpha.deb" })).toBe(true);
  });

  it("serves APT group signed install helpers", async () => {
    const plugin = createTestAptGroupPlugin({
      getPublicKey: async () => ({
        ...defaultSigningKey,
        repositoryName: "debian-group",
        publicKeyArmored: "-----BEGIN PGP PUBLIC KEY BLOCK-----",
      }),
    });

    expect(plugin.clientHelpers?.actions.map((action) => action.name)).toEqual(["key.gpg", "source", "install"]);
    const keyResponse = await dispatchRepositoryClientHelper(plugin.clientHelpers!, {
      repository: groupRepository(),
      action: "key.gpg",
      origin: "https://axis.example",
    });
    const installResponse = await dispatchRepositoryClientHelper(plugin.clientHelpers!, {
      repository: groupRepository(),
      action: "install",
      origin: "https://axis.example",
    });

    await expect(keyResponse.text()).resolves.toBe("-----BEGIN PGP PUBLIC KEY BLOCK-----");
    await expect(installResponse.json()).resolves.toMatchObject({
      keyUrl: "https://axis.example/repositories/debian-group/apt/key.gpg",
      sourceLine: "deb [signed-by=/usr/share/keyrings/axis-debian-group.gpg] https://axis.example/repositories/debian-group bookworm main",
    });
  });

  it("serves APT group unsigned install helpers without a signing key", async () => {
    const plugin = createTestAptGroupPlugin();

    const installResponse = await dispatchRepositoryClientHelper(plugin.clientHelpers!, {
      repository: unsignedGroupRepository(),
      action: "install",
      origin: "https://axis.example",
    });

    const install = await installResponse.json() as { keyUrl?: string; keyringPath?: string; sourceLine: string; script: string };
    expect(install.keyUrl).toBeUndefined();
    expect(install.keyringPath).toBeUndefined();
    expect(install.sourceLine).toBe("deb [trusted=yes] https://axis.example/repositories/debian-group bookworm main");
    expect(install.script).not.toContain("key.gpg");
  });

  it("aggregates APT group artifacts from the first member that provides each package family", async () => {
    const plugin = createTestAptGroupPlugin();
    const alphaHosted = repositoryArtifact({
      id: "artifact_alpha_hosted",
      repositoryName: "debian-internal",
      family: "apt:main:alpha",
        metadata: {
          package: "alpha",
          version: "1.0.0",
          architecture: "amd64",
          maintainer: "Alpha Maintainer <alpha@example.test>",
          description: "Alpha package",
          component: "main",
          filename: "pool/main/alpha/alpha_1.0.0_amd64.deb",
          size: 42,
          sha256: "a".repeat(64),
        },
    });
    const alphaProxy = repositoryArtifact({
      id: "artifact_alpha_proxy",
      repositoryName: "debian-proxy",
      family: "apt:main:alpha",
        metadata: {
          package: "alpha",
          version: "2.0.0",
          architecture: "amd64",
          maintainer: "Alpha Maintainer <alpha@example.test>",
          description: "Alpha package",
          component: "main",
          filename: "pool/main/alpha/alpha_2.0.0_amd64.deb",
          size: 43,
          sha256: "b".repeat(64),
        },
    });
    const betaProxy = repositoryArtifact({
      id: "artifact_beta_proxy",
      repositoryName: "debian-proxy",
      family: "apt:main:beta",
      name: "beta",
      metadata: {
        package: "beta",
        version: "1.0.0",
        architecture: "amd64",
        maintainer: "Beta Maintainer <beta@example.test>",
        description: "Beta package",
        component: "main",
        filename: "pool/main/beta/beta_1.0.0_amd64.deb",
        size: 44,
        sha256: "c".repeat(64),
      },
    });
    const artifactStore = repositoryArtifactStore({
      "debian-internal": [alphaHosted],
      "debian-proxy": [alphaProxy, betaProxy],
    });

    const artifacts = await plugin.artifacts?.rebuildIndex({
      repository: groupRepository(),
      objectStore: new MemoryRepositoryObjectStore(),
      now: new Date("2026-08-10T00:00:00.000Z"),
      repositoryArtifactStore: artifactStore,
    });

    expect(Array.isArray(artifacts) ? artifacts.map((artifact) => ({
      repositoryName: artifact.repositoryName,
      family: artifact.family,
      sourceRepositoryName: artifact.metadata.sourceRepositoryName,
      sourceArtifactId: artifact.metadata.sourceArtifactId,
      filename: artifact.metadata.filename,
    })) : []).toEqual([
      {
        repositoryName: "debian-group",
        family: "apt:group-package:apt:main:alpha",
        sourceRepositoryName: "debian-internal",
        sourceArtifactId: "artifact_alpha_hosted",
        filename: "pool/main/alpha/alpha_1.0.0_amd64.deb",
      },
      {
        repositoryName: "debian-group",
        family: "apt:group-package:apt:main:beta",
        sourceRepositoryName: "debian-proxy",
        sourceArtifactId: "artifact_beta_proxy",
        filename: "pool/main/beta/beta_1.0.0_amd64.deb",
      },
    ]);
  });

  it("writes signed APT group indexes from the aggregated member artifacts", async () => {
    const objectStore = new MemoryRepositoryObjectStore();
    const plugin = createTestAptGroupPlugin({
      getActivePrivateKey: async (id) => ({
        id,
        repositoryName: "debian-group",
        privateKeyArmored: "-----BEGIN PGP PRIVATE KEY BLOCK-----",
        passphrase: "passphrase",
        fingerprint: "FINGERPRINT",
        keyId: "KEYID",
      }),
    });
    const artifactStore = repositoryArtifactStore({
      "debian-internal": [
        repositoryArtifact({
          metadata: {
            package: "alpha",
            version: "1.0.0",
            architecture: "amd64",
            maintainer: "Alpha Maintainer <alpha@example.test>",
            description: "Alpha package",
            component: "main",
            filename: "pool/main/alpha/alpha_1.0.0_amd64.deb",
            size: 42,
            sha256: "a".repeat(64),
          },
        }),
      ],
    });

    await plugin.artifacts?.rebuildIndex({
      repository: groupRepository(),
      objectStore,
      now: new Date("2026-08-10T00:00:00.000Z"),
      repositoryArtifactStore: artifactStore,
    });

    await expect(storedText(objectStore, "repositories/debian-group/dists/bookworm/main/binary-amd64/Packages"))
      .resolves.toContain("Filename: pool/main/alpha/alpha_1.0.0_amd64.deb");
    await expect(storedText(objectStore, "repositories/debian-group/dists/bookworm/Release"))
      .resolves.toContain("Codename: bookworm");
    await expect(storedText(objectStore, "repositories/debian-group/dists/bookworm/InRelease"))
      .resolves.toContain("BEGIN PGP SIGNED MESSAGE");
    await expect(storedText(objectStore, "repositories/debian-group/dists/bookworm/Release.gpg"))
      .resolves.toContain("BEGIN PGP SIGNATURE");
  });

  it("writes unsigned APT group indexes without signature files", async () => {
    const objectStore = new MemoryRepositoryObjectStore();
    const plugin = createTestAptGroupPlugin();
    const artifactStore = repositoryArtifactStore({
      "debian-internal": [
        repositoryArtifact({
          metadata: {
            package: "alpha",
            version: "1.0.0",
            architecture: "amd64",
            maintainer: "Alpha Maintainer <alpha@example.test>",
            description: "Alpha package",
            component: "main",
            filename: "pool/main/alpha/alpha_1.0.0_amd64.deb",
            size: 42,
            sha256: "a".repeat(64),
          },
        }),
      ],
    });

    await plugin.artifacts?.rebuildIndex({
      repository: unsignedGroupRepository(),
      objectStore,
      now: new Date("2026-08-10T00:00:00.000Z"),
      repositoryArtifactStore: artifactStore,
    });

    await expect(storedText(objectStore, "repositories/debian-group/dists/bookworm/Release"))
      .resolves.toContain("Codename: bookworm");
    await expect(objectStore.getObject("repositories/debian-group/dists/bookworm/InRelease")).resolves.toBeNull();
    await expect(objectStore.getObject("repositories/debian-group/dists/bookworm/Release.gpg")).resolves.toBeNull();
  });
});

describe("APT proxy plugin lifecycle", () => {
  it("validates APT proxy config by probing the configured Release file", async () => {
    const upstreamRequests: Request[] = [];
    const plugin = createAptProxyPlugin({
      fetch: async (request) => {
        upstreamRequests.push(request);
        return new Response([
          "Codename: bookworm",
          "Components: main",
          "Architectures: amd64",
          "SHA256:",
          ` ${"1".repeat(64)} 220 main/binary-amd64/Packages`,
          "",
        ].join("\n"), {
          headers: { "content-type": "text/plain" },
        });
      },
    });

    await expect(plugin.validateRepositoryConfig({
      ecosystem: "apt",
      config: { apt: { upstreamUrl: "deb.example/debian", signing: { mode: "upstream" }, codename: "bookworm" } },
    })).resolves.toBeUndefined();

    expect(upstreamRequests.map((request) => request.url)).toEqual([
      "https://deb.example/debian/dists/bookworm/Release",
    ]);
  });

  it("accepts APT proxy Release metadata without requiring a matching Codename field", async () => {
    const plugin = createAptProxyPlugin({
      fetch: async () => new Response([
        "Suite: bookworm",
        "Components: stable",
        "Architectures: amd64",
        "SHA256:",
        ` ${"1".repeat(64)} 220 stable/binary-amd64/Packages`,
        "",
      ].join("\n")),
    });

    await expect(plugin.validateRepositoryConfig({
      ecosystem: "apt",
      config: { apt: { upstreamUrl: "https://download.docker.com/linux/debian/", signing: { mode: "upstream" }, codename: "bookworm" } },
    })).resolves.toBeUndefined();
  });

  it("reports the probed Release URL when APT proxy config cannot be verified", async () => {
    const plugin = createAptProxyPlugin({
      fetch: async () => new Response("not found", { status: 404 }),
    });

    await expect(plugin.validateRepositoryConfig({
      ecosystem: "apt",
      config: { apt: { upstreamUrl: "https://download.docker.com/linux/ubuntu/", signing: { mode: "upstream" }, codename: "bookworm" } },
    })).rejects.toThrow(
      "config.apt.upstreamUrl could not be verified as an APT repository: upstream returned 404 for https://download.docker.com/linux/ubuntu/dists/bookworm/Release",
    );
  });

  it("proxies APT dists and pool paths through the configured upstream", async () => {
    const upstreamRequests: Request[] = [];
    const plugin = createAptProxyPlugin({
      fetch: async (request) => {
        upstreamRequests.push(request);
        return new Response("deb bytes", {
          status: 206,
          headers: {
            "content-type": "application/vnd.debian.binary-package",
            "content-range": "bytes 0-8/20",
            "accept-ranges": "bytes",
            connection: "keep-alive",
          },
        });
      },
    });

    const response = await plugin.serveRepositoryPath?.({
      repository: proxyRepository(),
      request: new Request("https://axis.example/repositories/debian-proxy/pool/main/d/demo/demo_1.0_amd64.deb", {
        headers: { range: "bytes=0-8", "if-none-match": "\"etag\"" },
      }),
      relativePath: "pool/main/d/demo/demo_1.0_amd64.deb",
    });

    expect(upstreamRequests.map((request) => [request.url, request.headers.get("range"), request.headers.get("if-none-match")]))
      .toEqual([["https://deb.example/debian/pool/main/d/demo/demo_1.0_amd64.deb", "bytes=0-8", "\"etag\""]]);
    expect(response?.status).toBe(206);
    expect(response?.headers.get("content-type")).toBe("application/vnd.debian.binary-package");
    expect(response?.headers.get("content-range")).toBe("bytes 0-8/20");
    expect(response?.headers.has("connection")).toBe(false);
    await expect(response?.text()).resolves.toBe("deb bytes");
  });

  it("caches full APT proxy GET responses in object storage", async () => {
    const objectStore = new MemoryRepositoryObjectStore();
    const upstreamRequests: Request[] = [];
    const plugin = createAptProxyPlugin({
      objectStoreFor: () => objectStore,
      fetch: async (request) => {
        upstreamRequests.push(request);
        return new Response("deb bytes", {
          headers: {
            "content-type": "application/vnd.debian.binary-package",
            "content-length": "9",
            etag: "\"deb-etag\"",
            "last-modified": "Thu, 13 Aug 2026 00:00:00 GMT",
            "cache-control": "public, max-age=31536000",
          },
        });
      },
    });

    const first = await plugin.serveRepositoryPath?.({
      repository: proxyRepository(),
      request: new Request("https://axis.example/repositories/debian-proxy/pool/main/d/demo/demo_1.0_amd64.deb"),
      relativePath: "pool/main/d/demo/demo_1.0_amd64.deb",
    });
    const second = await plugin.serveRepositoryPath?.({
      repository: proxyRepository(),
      request: new Request("https://axis.example/repositories/debian-proxy/pool/main/d/demo/demo_1.0_amd64.deb"),
      relativePath: "pool/main/d/demo/demo_1.0_amd64.deb",
    });

    expect(upstreamRequests).toHaveLength(1);
    expect(first?.headers.get("etag")).toBe("\"deb-etag\"");
    expect(second?.headers.get("etag")).toBe("\"deb-etag\"");
    expect(second?.headers.get("last-modified")).toBe("Thu, 13 Aug 2026 00:00:00 GMT");
    expect(second?.headers.get("cache-control")).toBe("public, max-age=31536000");
    await expect(first?.text()).resolves.toBe("deb bytes");
    await expect(second?.text()).resolves.toBe("deb bytes");
  });

  it("serves APT proxy install helpers with an upstream signing key", async () => {
    const upstreamRequests: string[] = [];
    const plugin = createAptProxyPlugin({
      fetch: async (request) => {
        upstreamRequests.push(request.url);
        return new Response("upstream public key", {
          headers: { "content-type": "application/pgp-keys" },
        });
      },
    });

    expect(plugin.clientHelpers?.namespace).toBe("apt");
    expect(plugin.clientHelpers?.actions.map((action) => action.name)).toEqual(["key.gpg", "source", "install"]);

    const installResponse = await dispatchRepositoryClientHelper(plugin.clientHelpers!, {
      repository: proxyRepository({
        apt: {
          upstreamUrl: "https://download.docker.com/linux/debian/",
          signing: { mode: "upstream", upstreamKeyUrl: "https://download.docker.com/linux/debian/gpg" },
          codename: "bookworm",
          components: ["stable"],
        },
      }),
      action: "install",
      origin: "https://axis.example",
    });

    const install = await installResponse?.json() as { script: string };
    expect(install).toMatchObject({
      repository: "debian-proxy",
      keyUrl: "https://axis.example/repositories/debian-proxy/apt/key.gpg",
      keyringPath: "/usr/share/keyrings/axis-debian-proxy.gpg",
      sourceLine: "deb [signed-by=/usr/share/keyrings/axis-debian-proxy.gpg] https://axis.example/repositories/debian-proxy bookworm stable",
    });
    expect(install.script).toContain("curl -fsSL https://axis.example/repositories/debian-proxy/apt/key.gpg");
    expect(install.script).toContain("sudo apt update");

    const keyResponse = await dispatchRepositoryClientHelper(plugin.clientHelpers!, {
      repository: proxyRepository({
        apt: {
          upstreamUrl: "https://download.docker.com/linux/debian/",
          signing: { mode: "upstream", upstreamKeyUrl: "https://download.docker.com/linux/debian/gpg" },
          codename: "bookworm",
          components: ["stable"],
        },
      }),
      action: "key.gpg",
      origin: "https://axis.example",
    });

    expect(await keyResponse?.text()).toBe("upstream public key");
    expect(keyResponse?.headers.get("content-type")).toContain("application/pgp-keys");
    expect(upstreamRequests).toEqual(["https://download.docker.com/linux/debian/gpg"]);
  });

  it("serves APT proxy unsigned install helpers without a signing key", async () => {
    const plugin = createAptProxyPlugin();

    const installResponse = await dispatchRepositoryClientHelper(plugin.clientHelpers!, {
      repository: proxyRepository({
        apt: {
          upstreamUrl: "https://deb.example/debian/",
          signing: { mode: "unsigned" },
          codename: "bookworm",
          components: ["main"],
        },
      }),
      action: "install",
      origin: "https://axis.example",
    });

    const install = await installResponse?.json() as { keyUrl?: string; keyringPath?: string; sourceLine: string; script: string };
    expect(install.keyUrl).toBeUndefined();
    expect(install.keyringPath).toBeUndefined();
    expect(install.sourceLine).toBe("deb [trusted=yes] https://axis.example/repositories/debian-proxy bookworm main");
    expect(install.script).not.toContain("key.gpg");
    expect(install.script).toContain("echo 'deb [trusted=yes] https://axis.example/repositories/debian-proxy bookworm main'");
  });

  it("renders APT proxy pool files from artifact metadata as a virtual object browser", async () => {
    const plugin = createAptProxyPlugin();
    const artifact = {
      id: "artifact_debian-proxy_demo",
      repositoryName: "debian-proxy",
      ecosystem: "apt" as const,
      identity: "apt:stable:demo:1.0.0:amd64",
      family: "apt:stable:demo",
      name: "demo",
      version: "1.0.0",
      summary: "demo 1.0.0 amd64",
      primaryObjectKey: "pool/stable/d/demo/demo_1.0.0_amd64.deb",
      objectKeys: ["pool/stable/d/demo/demo_1.0.0_amd64.deb"],
      metadata: {
        filename: "pool/stable/d/demo/demo_1.0.0_amd64.deb",
        size: 42,
      },
      publishedAt: "2026-08-13T00:00:00.000Z",
      updatedAt: "2026-08-13T00:00:00.000Z",
    };
    const state = new MemoryStateStore();
    await state.repositoryArtifacts.upsert(artifact);

    await expect(plugin.objectBrowser?.listObjects({
      repository: proxyRepository(),
      objectStore: new MemoryRepositoryObjectStore(),
      repositoryArtifactStore: state.repositoryArtifacts,
      prefix: "pool/",
    })).resolves.toEqual({
      prefix: "pool/",
      directories: [{ name: "stable", path: "pool/stable/" }],
      objects: [],
      truncated: false,
    });
    await expect(plugin.objectBrowser?.listObjects({
      repository: proxyRepository(),
      objectStore: new MemoryRepositoryObjectStore(),
      repositoryArtifactStore: state.repositoryArtifacts,
      prefix: "pool/stable/d/demo/",
    })).resolves.toEqual({
      prefix: "pool/stable/d/demo/",
      directories: [],
      objects: [{
        name: "demo_1.0.0_amd64.deb",
        path: "pool/stable/d/demo/demo_1.0.0_amd64.deb",
        size: 42,
        contentType: "application/vnd.debian.binary-package",
      }],
      truncated: false,
    });
    await expect(plugin.objectBrowser?.getObjectDetail?.({
      repository: proxyRepository(),
      objectStore: new MemoryRepositoryObjectStore(),
      repositoryArtifactStore: state.repositoryArtifacts,
      path: "pool/stable/d/demo/demo_1.0.0_amd64.deb",
      origin: "https://axis.example",
    })).resolves.toMatchObject({
      name: "demo_1.0.0_amd64.deb",
      path: "pool/stable/d/demo/demo_1.0.0_amd64.deb",
      objectKey: "virtual:apt-proxy:pool/stable/d/demo/demo_1.0.0_amd64.deb",
      repositoryUrl: "https://axis.example/repositories/debian-proxy/pool/stable/d/demo/demo_1.0.0_amd64.deb",
      contentType: "application/vnd.debian.binary-package",
      size: 42,
    });
  });

  it("serves APT proxy byte cache stats from proxy admin resources", async () => {
    const objectStore = new MemoryRepositoryObjectStore();
    await objectStore.putBytes("repositories/debian-proxy/_proxy-cache/apt/files/file-a", new Uint8Array(7), "application/octet-stream");
    await objectStore.putJson("repositories/debian-proxy/_proxy-cache/apt/files/file-a.json", {});
    const plugin = createAptProxyPlugin({ objectStoreFor: () => objectStore });

    const response = await dispatchRepositoryAdminResource(plugin.adminResources!, {
      repositoryName: "debian-proxy",
      repository: proxyRepository(),
      request: new Request("https://axis.example/admin/repositories/debian-proxy/apt/proxy-cache"),
      path: ["proxy-cache"],
      services: {},
    });

    await expect(response.json()).resolves.toEqual({
      cache: {
        fileCount: 1,
        byteCount: 7,
      },
    });
  });

  it("serves APT proxy signing keys from proxy admin resources", async () => {
    const objectStore = new MemoryRepositoryObjectStore();
    const calls: Array<{ method: string; input?: unknown }> = [];
    const plugin = createAptProxyPlugin({
      objectStoreFor: () => objectStore,
      signingKeys: signingKeys({
        listForRepository: async (repositoryName: string) => {
          calls.push({ method: "listForRepository", input: repositoryName });
          return [{ ...defaultSigningKey, repositoryName: "debian-proxy" }];
        },
      }),
    });

    await expect(dispatchRepositoryAdminResource(plugin.adminResources!, {
      repositoryName: "debian-proxy",
      repository: proxyRepository(),
      request: new Request("https://axis.example/admin/repositories/debian-proxy/apt/signing-keys"),
      path: ["signing-keys"],
      services: {},
    }).then((response) => response.json())).resolves.toEqual({
      signingKeys: [{ ...defaultSigningKey, repositoryName: "debian-proxy" }],
    });
    await expect(dispatchRepositoryAdminResource(plugin.adminResources!, {
      repositoryName: "debian-proxy",
      repository: proxyRepository(),
      request: new Request("https://axis.example/admin/repositories/debian-proxy/apt/proxy-cache"),
      path: ["proxy-cache"],
      services: {},
    }).then((response) => response.json())).resolves.toEqual({
      cache: { fileCount: 0, byteCount: 0 },
    });
    expect(calls).toEqual([{ method: "listForRepository", input: "debian-proxy" }]);
  });

  it("serves APT proxy signing keys without requiring proxy cache resources", async () => {
    const plugin = createAptProxyPlugin({
      signingKeys: signingKeys({
        listForRepository: async () => [{ ...defaultSigningKey, repositoryName: "debian-proxy" }],
      }),
    });

    await expect(dispatchRepositoryAdminResource(plugin.adminResources!, {
      repositoryName: "debian-proxy",
      repository: proxyRepository(),
      request: new Request("https://axis.example/admin/repositories/debian-proxy/apt/signing-keys"),
      path: ["signing-keys"],
      services: {},
    }).then((response) => response.json())).resolves.toEqual({
      signingKeys: [{ ...defaultSigningKey, repositoryName: "debian-proxy" }],
    });
  });

  it("renders APT proxy files whose upstream Filename lives outside root pool", async () => {
    const plugin = createAptProxyPlugin();
    const state = new MemoryStateStore();
    await state.repositoryArtifacts.upsert({
      id: "artifact_debian-proxy_docker",
      repositoryName: "debian-proxy",
      ecosystem: "apt",
      identity: "apt:stable:docker-ce:1.0.0:amd64",
      family: "apt:stable:docker-ce",
      name: "docker-ce",
      version: "1.0.0",
      summary: "docker-ce 1.0.0 amd64",
      primaryObjectKey: "dists/bookworm/pool/stable/amd64/docker-ce_1.0.0_amd64.deb",
      objectKeys: ["dists/bookworm/pool/stable/amd64/docker-ce_1.0.0_amd64.deb"],
      metadata: {
        filename: "dists/bookworm/pool/stable/amd64/docker-ce_1.0.0_amd64.deb",
        size: 84,
      },
      publishedAt: "2026-08-13T00:00:00.000Z",
      updatedAt: "2026-08-13T00:00:00.000Z",
    });

    await expect(plugin.objectBrowser?.listObjects({
      repository: proxyRepository(),
      objectStore: new MemoryRepositoryObjectStore(),
      repositoryArtifactStore: state.repositoryArtifacts,
      prefix: "",
    })).resolves.toMatchObject({
      prefix: "",
      directories: [{ name: "dists", path: "dists/" }],
      objects: [],
      truncated: false,
    });
    await expect(plugin.objectBrowser?.listObjects({
      repository: proxyRepository(),
      objectStore: new MemoryRepositoryObjectStore(),
      repositoryArtifactStore: state.repositoryArtifacts,
      prefix: "dists/bookworm/pool/stable/amd64/",
    })).resolves.toMatchObject({
      prefix: "dists/bookworm/pool/stable/amd64/",
      directories: [],
      objects: [{
        name: "docker-ce_1.0.0_amd64.deb",
        path: "dists/bookworm/pool/stable/amd64/docker-ce_1.0.0_amd64.deb",
        size: 84,
        contentType: "application/vnd.debian.binary-package",
      }],
      truncated: false,
    });
  });

  it("bypasses the APT proxy byte cache for conditional requests", async () => {
    const objectStore = new MemoryRepositoryObjectStore();
    const upstreamRequests: Request[] = [];
    const plugin = createAptProxyPlugin({
      objectStoreFor: () => objectStore,
      fetch: async (request) => {
        upstreamRequests.push(request);
        return new Response(upstreamRequests.length === 1 ? "first" : "fresh", {
          headers: {
            "content-type": "application/vnd.debian.binary-package",
            "content-length": upstreamRequests.length === 1 ? "5" : "5",
          },
        });
      },
    });
    const repository = proxyRepository();

    await plugin.serveRepositoryPath?.({
      repository,
      request: new Request("https://axis.example/repositories/debian-proxy/pool/main/d/demo/demo_1.0_amd64.deb"),
      relativePath: "pool/main/d/demo/demo_1.0_amd64.deb",
    });
    const conditional = await plugin.serveRepositoryPath?.({
      repository,
      request: new Request("https://axis.example/repositories/debian-proxy/pool/main/d/demo/demo_1.0_amd64.deb", {
        headers: { "if-none-match": "\"deb-etag\"" },
      }),
      relativePath: "pool/main/d/demo/demo_1.0_amd64.deb",
    });

    expect(upstreamRequests).toHaveLength(2);
    expect(upstreamRequests[1]?.headers.get("if-none-match")).toBe("\"deb-etag\"");
    await expect(conditional?.text()).resolves.toBe("fresh");
  });

  it("rebuilds APT proxy artifacts from upstream Packages metadata", async () => {
    const objectStore = new MemoryRepositoryObjectStore();
    const plugin = createAptProxyPlugin({
      objectStoreFor: () => objectStore,
      fetch: async (request) => {
        if (request.url.endsWith("/dists/bookworm/Release")) {
          return new Response([
            "Codename: bookworm",
            "Components: main",
            "Architectures: amd64",
            "SHA256:",
            ` ${"1".repeat(64)} 220 main/binary-amd64/Packages`,
            "",
          ].join("\n"));
        }
        if (request.url.endsWith("/dists/bookworm/main/binary-amd64/Packages")) {
          return new Response([
            "Package: demo",
            "Version: 1.0.0",
            "Architecture: amd64",
            "Maintainer: Demo Maintainer <demo@example.test>",
            "Description: Demo package",
            "Filename: pool/main/d/demo/demo_1.0.0_amd64.deb",
            "Size: 42",
            `SHA256: ${"a".repeat(64)}`,
            "",
          ].join("\n"));
        }
        return new Response("not found", { status: 404 });
      },
    });

    const result = await plugin.artifacts?.rebuildIndex({
      repository: proxyRepository(),
      objectStore,
      now: new Date("2026-08-13T00:00:00.000Z"),
    });

    expect(Array.isArray(result) ? result : result?.artifacts).toEqual([
      expect.objectContaining({
        repositoryName: "debian-proxy",
        ecosystem: "apt",
        identity: "apt:main:demo:1.0.0:amd64",
        family: "apt:main:demo",
        name: "demo",
        version: "1.0.0",
        summary: "demo 1.0.0 amd64",
        primaryObjectKey: "pool/main/d/demo/demo_1.0.0_amd64.deb",
        objectKeys: ["pool/main/d/demo/demo_1.0.0_amd64.deb"],
        metadata: expect.objectContaining({
          package: "demo",
          component: "main",
          architecture: "amd64",
          filename: "pool/main/d/demo/demo_1.0.0_amd64.deb",
          size: 42,
          sha256: "a".repeat(64),
        }),
        publishedAt: "2026-08-13T00:00:00.000Z",
        updatedAt: "2026-08-13T00:00:00.000Z",
      }),
    ]);
  });

  it("writes APT proxy cached indexes inside the repository object namespace", async () => {
    const backingStore = new MemoryRepositoryObjectStore();
    const objectStore = repositoryScopedObjectStore(backingStore, "debian-proxy");
    const plugin = createAptProxyPlugin({
      fetch: async (request) => {
        if (request.url.endsWith("/dists/bookworm/Release")) {
          return new Response([
            "Suite: bookworm",
            "Components: stable",
            "Architectures: amd64",
            "SHA256:",
            ` ${"1".repeat(64)} 220 stable/binary-amd64/Packages`,
            "",
          ].join("\n"));
        }
        if (request.url.endsWith("/dists/bookworm/stable/binary-amd64/Packages")) {
          return new Response("Package: demo\nVersion: 1.0.0\nArchitecture: amd64\nFilename: pool/stable/d/demo/demo_1.0.0_amd64.deb\n");
        }
        return new Response("not found", { status: 404 });
      },
    });

    await expect(plugin.artifacts?.rebuildIndex({
      repository: proxyRepository(),
      objectStore,
      now: new Date("2026-08-13T00:00:00.000Z"),
    })).resolves.toMatchObject({ complete: true });

    expect(backingStore.objects.map((object) => object.key)).toEqual([
      "repositories/debian-proxy/dists/bookworm/stable/binary-amd64/Packages",
      "repositories/debian-proxy/dists/bookworm/Release",
    ]);
  });
});
