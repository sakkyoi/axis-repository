import { describe, expect, it } from "vitest";
import type { PublishArtifactsInput, Repository } from "@axis-repository/core";
import { MemoryRepositoryObjectStore } from "@axis-repository/runtime-cloudflare/plugin-runtime/testing";
import { createPypiPlugin } from "./runtime";
import { sdistBytes, wheelBytes } from "./dist-fixtures.test-support";
import { requireDistributionFilename } from "./names";

const NOW = new Date("2026-07-18T00:00:00.000Z");

function repository(): Repository {
  return {
    id: "repo_1",
    name: "python-internal",
    ecosystem: "pypi",
    visibility: "private",
    config: {},
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
}

function publishInput(sessionId: string, filenames: string[]): PublishArtifactsInput {
  return {
    repository: repository(),
    session: {
      id: sessionId,
      repositoryName: "python-internal",
      ecosystem: "pypi",
      status: "finalizing",
      requestedBy: {
        tokenId: "ptok_1",
        name: "ci",
        permissions: ["publish"],
        repositories: ["python-internal"],
        ecosystemScopes: {},
        signingKeyIds: [],
      },
      artifacts: filenames.map((filename) => ({
        filename,
        size: 32,
        sha256: "a".repeat(64),
        contentType: "application/octet-stream",
        metadata: {},
      })),
      uploads: [],
      verifiedUploads: [],
      createdAt: NOW.toISOString(),
      expiresAt: "2026-07-18T01:00:00.000Z",
      publishStartedAt: "2026-07-18T00:10:00.000Z",
    },
    artifacts: filenames.map((filename, index) => ({
      artifact: {
        filename,
        size: 32,
        sha256: "a".repeat(64),
        contentType: "application/octet-stream",
        metadata: {},
      },
      upload: {
        uploadId: `upl_${index + 1}`,
        filename,
        objectKey: `_staging/uploads/${sessionId}/upl_${index + 1}/${filename}`,
        method: "PUT",
        url: "https://uploads.local",
        headers: {},
        expiresAt: "2026-07-18T00:20:00.000Z",
      },
      verified: {
        uploadId: `upl_${index + 1}`,
        objectKey: `_staging/uploads/${sessionId}/upl_${index + 1}/${filename}`,
        size: 32,
        sha256: "a".repeat(64),
        verifiedAt: "2026-07-18T00:05:00.000Z",
      },
    })),
  };
}

/** Builds the distribution a filename claims to be, so publishing accepts it. */
function distributionBytes(filename: string): Uint8Array {
  const distribution = requireDistributionFilename(filename);
  const fixture = { name: distribution.rawName, version: distribution.version };
  return distribution.kind === "wheel" ? wheelBytes(fixture) : sdistBytes(fixture);
}

async function harness() {
  const objectStore = new MemoryRepositoryObjectStore();
  const plugin = createPypiPlugin({ objectStoreFor: () => objectStore });

  return {
    objectStore,
    plugin,
    async publish(sessionId: string, filenames: string[]) {
      for (const [index, filename] of filenames.entries()) {
        await objectStore.putBytes(
          `_staging/uploads/${sessionId}/upl_${index + 1}/${filename}`,
          distributionBytes(filename),
          "application/octet-stream",
        );
      }
      const input = publishInput(sessionId, filenames);
      const result = await plugin.publish.finalize(input);
      const artifacts = plugin.publish.describeArtifacts?.({
        repository: input.repository,
        session: input.session,
        result,
      }) ?? [];
      return { result, artifacts };
    },
  };
}

function storedKeys(objectStore: MemoryRepositoryObjectStore): string[] {
  const live = new Set<string>();
  for (const object of objectStore.objects) {
    live.add(object.key);
  }
  return [...live].sort();
}

describe("publishing to a PyPI repository", () => {
  it("puts a distribution where a client can fetch it", async () => {
    // Before this, a published wheel stayed in staging, which the plugin does
    // not serve — the file was not reachable at any URL at all.
    const pypi = await harness();

    await pypi.publish("pub_1", ["my_project-1.0-py3-none-any.whl"]);

    const key = "repositories/python-internal/packages/my-project/my_project-1.0-py3-none-any.whl";
    expect(storedKeys(pypi.objectStore)).toContain(key);
    const relativePath = key.slice("repositories/python-internal/".length);
    expect(pypi.plugin.canServeRepositoryPath({ relativePath })).toBe(true);
  });

  it("files a wheel and an sdist of one project into the same directory", async () => {
    const pypi = await harness();

    await pypi.publish("pub_1", ["zope_interface-6.1-py3-none-any.whl", "zope.interface-6.1.tar.gz"]);

    expect(storedKeys(pypi.objectStore).filter((key) => key.includes("/packages/"))).toEqual([
      "repositories/python-internal/packages/zope-interface/zope.interface-6.1.tar.gz",
      "repositories/python-internal/packages/zope-interface/zope_interface-6.1-py3-none-any.whl",
    ]);
  });

  it("keeps what earlier publishes stored", async () => {
    const pypi = await harness();

    await pypi.publish("pub_1", ["alpha-1.0.tar.gz"]);
    await pypi.publish("pub_2", ["beta-2.0.tar.gz"]);

    const packages = storedKeys(pypi.objectStore).filter((key) => key.includes("/packages/"));
    expect(packages).toHaveLength(2);
  });

  it("reports the stored file as the artifact, not the staged upload", async () => {
    const pypi = await harness();

    const { artifacts } = await pypi.publish("pub_1", ["my_project-1.0-py3-none-any.whl"]);

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.primaryObjectKey)
      .toBe("repositories/python-internal/packages/my-project/my_project-1.0-py3-none-any.whl");
    expect(artifacts[0]?.objectKeys.some((key) => key.includes("_staging"))).toBe(false);
    expect(artifacts[0]?.metadata).toMatchObject({ project: "my-project", version: "1.0" });
  });

  it("refuses a session that would store two files at one path", async () => {
    // Both spellings normalize to the same project and carry the same
    // filename, so the second copy would silently replace the first while the
    // session reported both as published.
    const pypi = await harness();

    await expect(pypi.publish("pub_1", ["alpha-1.0.tar.gz", "alpha-1.0.tar.gz"]))
      .rejects.toThrow(/same distribution twice/);
  });

  it("refuses a file whose contents are a different project than its name", async () => {
    // The filename is what puts a file on a project page. A wheel named after
    // Django, containing something else, would be handed to everyone who asks
    // pip for Django — so the package's own record of itself has to agree.
    const objectStore = new MemoryRepositoryObjectStore();
    const plugin = createPypiPlugin({ objectStoreFor: () => objectStore });
    await objectStore.putBytes(
      "_staging/uploads/pub_1/upl_1/django-5.0.tar.gz",
      sdistBytes({ name: "django", version: "5.0", metadata: "Name: impostor\nVersion: 5.0\n" }),
      "application/octet-stream",
    );

    await expect(plugin.publish.finalize(publishInput("pub_1", ["django-5.0.tar.gz"])))
      .rejects.toThrow(/says django but its metadata says impostor/);
  });

  it("refuses a file whose contents are a different version than its name", async () => {
    const objectStore = new MemoryRepositoryObjectStore();
    const plugin = createPypiPlugin({ objectStoreFor: () => objectStore });
    await objectStore.putBytes(
      "_staging/uploads/pub_1/upl_1/thing-1.0-py3-none-any.whl",
      wheelBytes({ name: "thing", version: "1.0", metadata: "Name: thing\nVersion: 9.9\n" }),
      "application/octet-stream",
    );

    await expect(plugin.publish.finalize(publishInput("pub_1", ["thing-1.0-py3-none-any.whl"])))
      .rejects.toThrow(/version 1.0 but its metadata says 9.9/);
  });

  it("rebuilds the index from the stored files rather than any bookkeeping", async () => {
    // A repository has to be repairable when whatever was written alongside
    // the files is lost, so the files themselves are the record.
    const pypi = await harness();
    await pypi.publish("pub_1", ["alpha-1.0.tar.gz", "beta-2.0-py3-none-any.whl"]);

    const rebuilt = await pypi.plugin.artifacts!.rebuildIndex({
      repository: repository(),
      objectStore: pypi.objectStore,
      now: NOW,
    });

    expect(rebuilt.map((artifact) => artifact.identity).sort()).toEqual([
      "pypi:alpha:alpha-1.0.tar.gz",
      "pypi:beta:beta-2.0-py3-none-any.whl",
    ]);
  });

  it("gives a rebuilt artifact the same identity a publish gave it", async () => {
    // Otherwise a rebuild produces a second record for every file already
    // indexed instead of restating what is there.
    const pypi = await harness();
    const { artifacts } = await pypi.publish("pub_1", ["alpha-1.0.tar.gz"]);

    const rebuilt = await pypi.plugin.artifacts!.rebuildIndex({
      repository: repository(),
      objectStore: pypi.objectStore,
      now: NOW,
    });

    expect(rebuilt.map((artifact) => artifact.id)).toEqual(artifacts.map((artifact) => artifact.id));
    expect(rebuilt.map((artifact) => artifact.identity)).toEqual(artifacts.map((artifact) => artifact.identity));
  });
});
