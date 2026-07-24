import type { ArtifactPublisher, PublishArtifactsInput } from "@axis-repository/core";
import { ValidationError } from "@axis-repository/core";
import { describe, expect, it } from "vitest";
import {
  RepositoryRuntimePluginRegistry,
  createPrefixServingPredicate,
  dispatchRepositoryClientHelper,
  dispatchRepositoryAdminResource,
  type RepositoryAdminResourceServices,
} from "./repository-runtime-plugin-registry";

function acceptsPluginServices(_services: RepositoryAdminResourceServices): void {}

// @ts-expect-error plugin services must be explicit capabilities, not arbitrary host service bags.
acceptsPluginServices({ signingKeyService: {} });

function publishInput(ecosystem: string): PublishArtifactsInput {
  return {
    repository: {
      id: "repo_1",
      name: `${ecosystem}-internal`,
      ecosystem,
      visibility: "private",
      config: {},
      createdAt: "2026-07-18T00:00:00.000Z",
      updatedAt: "2026-07-18T00:00:00.000Z",
    },
    session: {
      id: "pub_1",
      repositoryName: `${ecosystem}-internal`,
      ecosystem,
      status: "finalizing",
      requestedBy: {
        tokenId: "tok_1",
        name: "ci",
        permissions: ["publish"],
        repositories: [`${ecosystem}-internal`],
        ecosystemScopes: {},
        signingKeyIds: [],
      },
      artifacts: [],
      uploads: [],
      verifiedUploads: [],
      createdAt: "2026-07-18T00:00:00.000Z",
      expiresAt: "2026-07-18T01:00:00.000Z",
      publishStartedAt: "2026-07-18T00:00:30.000Z",
      finalizingStartedAt: "2026-07-18T00:00:30.000Z",
    },
    artifacts: [],
  };
}

function publisherReturning(key: string): {
  publisher: ArtifactPublisher;
  calls: PublishArtifactsInput[];
} {
  const calls: PublishArtifactsInput[] = [];
  return {
    calls,
    publisher: {
      publish: async (input) => {
        calls.push(input);
        return {
          publishedAt: "2026-07-18T00:00:30.000Z",
          objects: [{ key, contentType: "application/json; charset=utf-8" }],
        };
      },
    },
  };
}

function publishLifecycle(
  publisher: ArtifactPublisher,
  hooks: {
    validateArtifacts?: () => void;
    authorize?: () => void;
  } = {},
) {
  return {
    validateArtifacts: hooks.validateArtifacts ?? (() => {}),
    authorize: hooks.authorize ?? (() => {}),
    finalize: (input: PublishArtifactsInput) => publisher.publish(input),
  };
}

describe("RepositoryRuntimePluginRegistry", () => {
  it("dispatches publish calls to the publisher registered for the repository ecosystem", async () => {
    const registry = new RepositoryRuntimePluginRegistry();
    const apt = publisherReturning("apt.json");
    const pypi = publisherReturning("pypi.json");
    registry.register({
      ecosystem: "apt",
      name: "apt-test",
      version: "0.0.0",
      capabilities: ["package-index"],
      canServeRepositoryPath: () => false,
      validateRepositoryConfig: () => {},
      publish: publishLifecycle(apt.publisher),
    });
    registry.register({
      ecosystem: "pypi",
      name: "pypi-test",
      version: "0.0.0",
      capabilities: ["simple-api"],
      canServeRepositoryPath: () => false,
      validateRepositoryConfig: () => {},
      publish: publishLifecycle(pypi.publisher),
    });

    await expect(registry.publish(publishInput("pypi"))).resolves.toEqual({
      publishedAt: "2026-07-18T00:00:30.000Z",
      objects: [{ key: "pypi.json", contentType: "application/json; charset=utf-8" }],
    });

    expect(apt.calls).toHaveLength(0);
    expect(pypi.calls).toHaveLength(1);
    expect(pypi.calls[0]?.repository.ecosystem).toBe("pypi");
  });

  it("fails closed when no publisher is registered for the repository ecosystem", async () => {
    const registry = new RepositoryRuntimePluginRegistry();

    await expect(registry.publish(publishInput("npm"))).rejects.toThrow(
      new ValidationError("Artifact publisher is not configured for ecosystem: npm"),
    );
  });

  it("rejects duplicate ecosystem registrations", () => {
    const registry = new RepositoryRuntimePluginRegistry();
    const first = publisherReturning("first.json");
    const second = publisherReturning("second.json");

    registry.register({
      ecosystem: "apt",
      name: "apt-first",
      version: "1.0.0",
      capabilities: ["generic-manifest"],
      canServeRepositoryPath: () => false,
      validateRepositoryConfig: () => {},
      publish: publishLifecycle(first.publisher),
    });

    expect(() =>
      registry.register({
        ecosystem: "apt",
        name: "apt-second",
        version: "2.0.0",
        capabilities: ["package-index"],
        canServeRepositoryPath: () => false,
        validateRepositoryConfig: () => {},
        publish: publishLifecycle(second.publisher),
      }),
    ).toThrow(new ValidationError("Artifact publisher is already registered for ecosystem: apt"));
  });

  it("lists diagnostic metadata without exposing publisher instances", () => {
    const registry = new RepositoryRuntimePluginRegistry();
    const apt = publisherReturning("apt.json");
    registry.register({
      ecosystem: "apt",
      name: "generic-manifest",
      version: "0.0.0",
      capabilities: ["generic-manifest", "client-helpers"],
      canServeRepositoryPath: () => false,
      validateRepositoryConfig: () => {},
      publish: publishLifecycle(apt.publisher),
      clientHelpers: {
        namespace: "apt",
        actions: [
          {
            name: "install",
            label: "Install",
            responseKind: "shell",
            defaultOpen: true,
            public: true,
            handle: async () => new Response("ok"),
          },
        ],
      },
    });

    expect(registry.list()).toEqual([
      {
        ecosystem: "apt",
        name: "generic-manifest",
        version: "0.0.0",
        capabilities: ["generic-manifest", "client-helpers"],
        clientHelpers: {
          namespace: "apt",
          actions: [
            {
              name: "install",
              label: "Install",
              responseKind: "shell",
              defaultOpen: true,
              public: true,
            },
          ],
        },
      },
    ]);
    expect(registry.list()[0]).not.toHaveProperty("publisher");
    expect(registry.list()[0]).not.toHaveProperty("handle");
  });

  it("returns the plugin registered for an ecosystem", () => {
    const registry = new RepositoryRuntimePluginRegistry();
    const apt = publisherReturning("apt.json");
    registry.register({
      ecosystem: "apt",
      name: "apt-signed",
      version: "0.1.0",
      capabilities: ["package-index"],
      canServeRepositoryPath: () => true,
      validateRepositoryConfig: () => {},
      publish: publishLifecycle(apt.publisher),
    });

    const plugin = registry.getPlugin("apt");

    expect(plugin?.ecosystem).toBe("apt");
    expect(plugin?.name).toBe("apt-signed");
    expect(plugin?.canServeRepositoryPath({ relativePath: "dists/noble/InRelease" })).toBe(true);
  });

  it("returns undefined for ecosystems without a plugin", () => {
    const registry = new RepositoryRuntimePluginRegistry();

    expect(registry.getPlugin("pypi")).toBeUndefined();
  });

  it("creates prefix serving predicates that allow only exact roots and nested children", () => {
    const canServe = createPrefixServingPredicate(["dists", "pool"]);

    expect(canServe({ relativePath: "dists/noble/InRelease" })).toBe(true);
    expect(canServe({ relativePath: "pool/main/app.deb" })).toBe(true);
    expect(canServe({ relativePath: "dists" })).toBe(true);
    expect(canServe({ relativePath: "pool" })).toBe(true);
    expect(canServe({ relativePath: "poolish/main/app.deb" })).toBe(false);
    expect(canServe({ relativePath: "simple/example/" })).toBe(false);
    expect(canServe({ relativePath: "secret" })).toBe(false);
  });

  it("fails closed when requiring an unregistered plugin", () => {
    const registry = new RepositoryRuntimePluginRegistry();

    expect(() => registry.requirePlugin("npm")).toThrow(
      new ValidationError("Artifact repository plugin is not configured for ecosystem: npm"),
    );
  });

  it("keeps lifecycle hooks on registered plugins", () => {
    const registry = new RepositoryRuntimePluginRegistry();
    const publisher = publisherReturning("apt.json");
    const calls: string[] = [];
    registry.register({
      ecosystem: "apt",
      name: "apt-test",
      version: "0.0.0",
      capabilities: ["package-index"],
      canServeRepositoryPath: () => false,
      validateRepositoryConfig: () => calls.push("config"),
      publish: publishLifecycle(publisher.publisher, {
        validateArtifacts: () => calls.push("artifacts"),
        authorize: () => calls.push("authorize"),
      }),
    });

    const input = publishInput("apt");
    const plugin = registry.requirePlugin("apt");
    plugin.validateRepositoryConfig({ ecosystem: "apt", config: {} });
    plugin.publish.validateArtifacts({
      repository: input.repository,
      artifacts: input.session.artifacts,
    });
    plugin.publish.authorize({
      repository: input.repository,
      principal: input.session.requestedBy,
      artifacts: input.session.artifacts,
    });

    expect(calls).toEqual(["config", "artifacts", "authorize"]);
  });

  it("keeps publish lifecycle hooks grouped under the publish capability", async () => {
    const registry = new RepositoryRuntimePluginRegistry();
    const calls: string[] = [];
    registry.register({
      ecosystem: "apt",
      name: "apt-test",
      version: "0.0.0",
      capabilities: ["package-index"],
      canServeRepositoryPath: () => false,
      validateRepositoryConfig: () => calls.push("config"),
      publish: {
        validateArtifacts: () => calls.push("artifacts"),
        derivePrincipalScope: () => {
          calls.push("scope");
          return { signingKeyIds: ["key_1"] };
        },
        authorize: () => calls.push("authorize"),
        finalize: async () => {
          calls.push("finalize");
          return {
            publishedAt: "2026-07-18T00:00:30.000Z",
            objects: [{ key: "apt.json", contentType: "application/json; charset=utf-8" }],
          };
        },
      },
    });

    const input = publishInput("apt");
    const plugin = registry.requirePlugin("apt");
    plugin.validateRepositoryConfig({ ecosystem: "apt", config: {} });
    plugin.publish.validateArtifacts({
      repository: input.repository,
      artifacts: input.session.artifacts,
    });
    expect(plugin.publish.derivePrincipalScope?.(input.repository)).toEqual({ signingKeyIds: ["key_1"] });
    plugin.publish.authorize({
      repository: input.repository,
      principal: input.session.requestedBy,
      artifacts: input.session.artifacts,
    });

    await expect(registry.publish(input)).resolves.toEqual({
      publishedAt: "2026-07-18T00:00:30.000Z",
      objects: [{ key: "apt.json", contentType: "application/json; charset=utf-8" }],
    });
    expect(calls).toEqual(["config", "artifacts", "scope", "authorize", "finalize"]);
  });

  it("keeps client helper metadata on registered plugins without exposing mutable action lists", () => {
    const registry = new RepositoryRuntimePluginRegistry();
    const publisher = publisherReturning("apt.json");
    registry.register({
      ecosystem: "apt",
      name: "apt-test",
      version: "0.0.0",
      capabilities: ["client-helpers"],
      canServeRepositoryPath: () => false,
      validateRepositoryConfig: () => {},
      publish: publishLifecycle(publisher.publisher),
      clientHelpers: {
        namespace: "apt",
        actions: [
          {
            name: "install",
            label: "Install",
            responseKind: "shell",
            defaultOpen: true,
            public: true,
            handle: async () => new Response("install"),
          },
        ],
      },
    });

    registry.requirePlugin("apt").clientHelpers?.actions.push({
      name: "mutated",
      label: "Mutated",
      responseKind: "text",
      defaultOpen: false,
      public: true,
      handle: async () => new Response("mutated"),
    });

    registry.requirePlugin("apt").clientHelpers!.actions[0]!.label = "Mutated";

    expect(registry.requirePlugin("apt").clientHelpers?.actions).toEqual([
      expect.objectContaining({
        name: "install",
        label: "Install",
        responseKind: "shell",
        defaultOpen: true,
        public: true,
      }),
    ]);
    expect(registry.list()[0]?.clientHelpers?.actions[0]).not.toHaveProperty("handle");
  });

  it("dispatches client helper actions through action-level handlers", async () => {
    const registry = new RepositoryRuntimePluginRegistry();
    const publisher = publisherReturning("apt.json");
    registry.register({
      ecosystem: "apt",
      name: "apt-test",
      version: "0.0.0",
      capabilities: ["client-helpers"],
      canServeRepositoryPath: () => false,
      validateRepositoryConfig: () => {},
      publish: publishLifecycle(publisher.publisher),
      clientHelpers: {
        namespace: "apt",
        actions: [
          {
            name: "install",
            label: "Install",
            responseKind: "shell",
            defaultOpen: true,
            public: true,
            handle: async ({ repository }) => new Response(`install ${repository.name}`),
          },
          {
            name: "private-diagnostic",
            label: "Private diagnostic",
            responseKind: "json",
            defaultOpen: false,
            public: false,
            handle: async () => new Response("private"),
          },
        ],
      },
    });

    const helpers = registry.requirePlugin("apt").clientHelpers!;
    const response = await dispatchRepositoryClientHelper(helpers, {
      repository: publishInput("apt").repository,
      action: "install",
      origin: "https://axis.example",
      signingKeys: {
        getPublicKey: async () => ({ publicKeyArmored: "unused" }),
      },
    });

    await expect(response.text()).resolves.toBe("install apt-internal");
    expect(helpers.actions.find((action) => action.name === "install")?.public).toBe(true);
    expect(helpers.actions.find((action) => action.name === "private-diagnostic")?.public).toBe(false);
    await expect(dispatchRepositoryClientHelper(helpers, {
      repository: publishInput("apt").repository,
      action: "missing",
      origin: "https://axis.example",
      signingKeys: {
        getPublicKey: async () => ({ publicKeyArmored: "unused" }),
      },
    })).rejects.toThrow(new ValidationError("Repository client helper is not configured: missing"));
  });

  it("keeps admin resource routes on registered plugins without exposing mutable metadata", async () => {
    const registry = new RepositoryRuntimePluginRegistry();
    const publisher = publisherReturning("apt.json");
    registry.register({
      ecosystem: "apt",
      name: "apt-test",
      version: "0.0.0",
      capabilities: ["admin-resources"],
      canServeRepositoryPath: () => false,
      validateRepositoryConfig: () => {},
      publish: publishLifecycle(publisher.publisher),
      adminResources: {
        namespace: "apt",
        routes: [
          {
            method: "POST",
            path: ["signing-keys", ":id", "revoke"],
            handle: async ({ params }) => new Response(`revoked ${params.id}`),
          },
        ],
      },
    });

    registry.requirePlugin("apt").adminResources!.namespace = "mutated";
    registry.requirePlugin("apt").adminResources!.routes.push({
      method: "GET",
      path: ["mutated"],
      handle: async () => new Response("mutated"),
    });
    const plugin = registry.requirePlugin("apt");

    expect(plugin.adminResources?.namespace).toBe("apt");
    expect(plugin.adminResources?.routes).toHaveLength(1);
    const response = await dispatchRepositoryAdminResource(plugin.adminResources!, {
      repositoryName: "apt-internal",
      repository: publishInput("apt").repository,
      request: new Request("https://axis.example/admin/repositories/apt-internal/apt/signing-keys/key_1/revoke", {
        method: "POST",
      }),
      path: ["signing-keys", "key_1", "revoke"],
      services: {},
    });
    await expect(response.text()).resolves.toBe("revoked key_1");
    await expect(dispatchRepositoryAdminResource(plugin.adminResources!, {
      repositoryName: "apt-internal",
      repository: publishInput("apt").repository,
      request: new Request("https://axis.example/admin/repositories/apt-internal/apt/signing-keys/key_1", {
        method: "DELETE",
      }),
      path: ["signing-keys", "key_1"],
      services: {},
    })).rejects.toThrow(new ValidationError("Repository admin resource route is not configured: DELETE signing-keys/key_1"));
  });

  it("finds plugins by admin resource namespace", () => {
    const registry = new RepositoryRuntimePluginRegistry();
    const publisher = publisherReturning("apt.json");
    registry.register({
      ecosystem: "apt",
      name: "apt-test",
      version: "0.0.0",
      capabilities: ["admin-resources"],
      canServeRepositoryPath: () => false,
      validateRepositoryConfig: () => {},
      publish: publishLifecycle(publisher.publisher),
      adminResources: {
        namespace: "apt",
        routes: [
          {
            method: "GET",
            path: ["signing-keys"],
            handle: async () => new Response("handled"),
          },
        ],
      },
    });

    expect(registry.getPluginByAdminResourceNamespace("apt")?.ecosystem).toBe("apt");
    expect(registry.getPluginByAdminResourceNamespace("npm")).toBeUndefined();
  });
});
