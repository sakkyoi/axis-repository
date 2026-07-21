import type { ArtifactPublisher, PublishArtifactsInput } from "@axis-repository/core";
import { ValidationError } from "@axis-repository/core";
import { describe, expect, it } from "vitest";
import { ArtifactPublisherRegistry, createPrefixServingPredicate } from "./artifact-publisher-registry";

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

describe("ArtifactPublisherRegistry", () => {
  it("dispatches publish calls to the publisher registered for the repository ecosystem", async () => {
    const registry = new ArtifactPublisherRegistry();
    const apt = publisherReturning("apt.json");
    const pypi = publisherReturning("pypi.json");
    registry.register({
      ecosystem: "apt",
      name: "apt-test",
      version: "0.0.0",
      capabilities: ["package-index"],
      publisher: apt.publisher,
      canServeRepositoryPath: () => false,
      validateRepositoryConfig: () => {},
      validatePublishArtifacts: () => {},
      authorizePublish: () => {},
    });
    registry.register({
      ecosystem: "pypi",
      name: "pypi-test",
      version: "0.0.0",
      capabilities: ["simple-api"],
      publisher: pypi.publisher,
      canServeRepositoryPath: () => false,
      validateRepositoryConfig: () => {},
      validatePublishArtifacts: () => {},
      authorizePublish: () => {},
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
    const registry = new ArtifactPublisherRegistry();

    await expect(registry.publish(publishInput("npm"))).rejects.toThrow(
      new ValidationError("Artifact publisher is not configured for ecosystem: npm"),
    );
  });

  it("rejects duplicate ecosystem registrations", () => {
    const registry = new ArtifactPublisherRegistry();
    const first = publisherReturning("first.json");
    const second = publisherReturning("second.json");

    registry.register({
      ecosystem: "apt",
      name: "apt-first",
      version: "1.0.0",
      capabilities: ["generic-manifest"],
      publisher: first.publisher,
      canServeRepositoryPath: () => false,
      validateRepositoryConfig: () => {},
      validatePublishArtifacts: () => {},
      authorizePublish: () => {},
    });

    expect(() =>
      registry.register({
        ecosystem: "apt",
        name: "apt-second",
        version: "2.0.0",
        capabilities: ["package-index"],
        publisher: second.publisher,
        canServeRepositoryPath: () => false,
        validateRepositoryConfig: () => {},
        validatePublishArtifacts: () => {},
        authorizePublish: () => {},
      }),
    ).toThrow(new ValidationError("Artifact publisher is already registered for ecosystem: apt"));
  });

  it("lists diagnostic metadata without exposing publisher instances", () => {
    const registry = new ArtifactPublisherRegistry();
    const apt = publisherReturning("apt.json");
    registry.register({
      ecosystem: "apt",
      name: "generic-manifest",
      version: "0.0.0",
      capabilities: ["generic-manifest"],
      publisher: apt.publisher,
      canServeRepositoryPath: () => false,
      validateRepositoryConfig: () => {},
      validatePublishArtifacts: () => {},
      authorizePublish: () => {},
    });

    expect(registry.list()).toEqual([
      {
        ecosystem: "apt",
        name: "generic-manifest",
        version: "0.0.0",
        capabilities: ["generic-manifest"],
      },
    ]);
    expect(registry.list()[0]).not.toHaveProperty("publisher");
  });

  it("returns the plugin registered for an ecosystem", () => {
    const registry = new ArtifactPublisherRegistry();
    const apt = publisherReturning("apt.json");
    registry.register({
      ecosystem: "apt",
      name: "apt-signed",
      version: "0.1.0",
      capabilities: ["package-index"],
      publisher: apt.publisher,
      canServeRepositoryPath: () => true,
      validateRepositoryConfig: () => {},
      validatePublishArtifacts: () => {},
      authorizePublish: () => {},
    });

    const plugin = registry.getPlugin("apt");

    expect(plugin?.ecosystem).toBe("apt");
    expect(plugin?.name).toBe("apt-signed");
    expect(plugin?.canServeRepositoryPath({ relativePath: "dists/noble/InRelease" })).toBe(true);
  });

  it("returns undefined for ecosystems without a plugin", () => {
    const registry = new ArtifactPublisherRegistry();

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
    const registry = new ArtifactPublisherRegistry();

    expect(() => registry.requirePlugin("npm")).toThrow(
      new ValidationError("Artifact repository plugin is not configured for ecosystem: npm"),
    );
  });

  it("keeps lifecycle hooks on registered plugins", () => {
    const registry = new ArtifactPublisherRegistry();
    const publisher = publisherReturning("apt.json");
    const calls: string[] = [];
    registry.register({
      ecosystem: "apt",
      name: "apt-test",
      version: "0.0.0",
      capabilities: ["package-index"],
      publisher: publisher.publisher,
      canServeRepositoryPath: () => false,
      validateRepositoryConfig: () => calls.push("config"),
      validatePublishArtifacts: () => calls.push("artifacts"),
      authorizePublish: () => calls.push("authorize"),
    });

    const input = publishInput("apt");
    const plugin = registry.requirePlugin("apt");
    plugin.validateRepositoryConfig({ ecosystem: "apt", config: {} });
    plugin.validatePublishArtifacts({
      repository: input.repository,
      artifacts: input.session.artifacts,
    });
    plugin.authorizePublish({
      repository: input.repository,
      principal: input.session.requestedBy,
      artifacts: input.session.artifacts,
    });

    expect(calls).toEqual(["config", "artifacts", "authorize"]);
  });
});
