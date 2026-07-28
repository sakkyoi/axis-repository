import { describe, expect, it } from "vitest";
import type { PublishArtifactsInput, Repository } from "@axis-repository/core";
import { MemoryRepositoryObjectStore } from "@axis-repository/runtime-cloudflare/plugin-runtime/testing";
import { createPypiPlugin } from "./runtime";
import { sdistBytes, wheelBytes } from "../shared/dist-fixtures.test-support";
import { requireDistributionFilename } from "../shared/names";

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
async function distributionBytes(filename: string): Promise<Uint8Array> {
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
          await distributionBytes(filename),
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

function storedText(objectStore: MemoryRepositoryObjectStore, key: string): string | undefined {
  const value = [...objectStore.objects].reverse().find((object) => object.key === key)?.value;
  return typeof value === "string" ? value : undefined;
}

/** How many times a key has been written, the store keeping every write. */
function writeCount(objectStore: MemoryRepositoryObjectStore, key: string): number {
  return [...objectStore.objects].filter((object) => object.key === key).length;
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

    expect(storedKeys(pypi.objectStore).filter((key) => key.includes("/packages/") && !key.endsWith(".metadata")))
      .toEqual([
        "repositories/python-internal/packages/zope-interface/zope.interface-6.1.tar.gz",
        "repositories/python-internal/packages/zope-interface/zope_interface-6.1-py3-none-any.whl",
      ]);
  });

  it("keeps what earlier publishes stored", async () => {
    const pypi = await harness();

    await pypi.publish("pub_1", ["alpha-1.0.tar.gz"]);
    await pypi.publish("pub_2", ["beta-2.0.tar.gz"]);

    const packages = storedKeys(pypi.objectStore)
      .filter((key) => key.includes("/packages/") && !key.endsWith(".metadata"));
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

  it("lists a published file on the project's page", async () => {
    const pypi = await harness();

    await pypi.publish("pub_1", ["my_project-1.0-py3-none-any.whl"]);

    const page = storedText(pypi.objectStore, "repositories/python-internal/simple/my-project/index.html");
    expect(page).toContain("my_project-1.0-py3-none-any.whl");
    expect(page).toContain("#sha256=");
  });

  it("lists the project on the root index", async () => {
    const pypi = await harness();

    await pypi.publish("pub_1", ["my_project-1.0-py3-none-any.whl"]);

    expect(storedText(pypi.objectStore, "repositories/python-internal/simple/index.html"))
      .toContain('<a href="my-project/">my-project</a>');
  });

  it("keeps earlier releases on the page when a new one is published", async () => {
    // Publishing is additive. A page that only listed the newest release would
    // make every earlier version uninstallable the moment one was added.
    const pypi = await harness();

    await pypi.publish("pub_1", ["alpha-1.0.tar.gz"]);
    await pypi.publish("pub_2", ["alpha-2.0.tar.gz"]);

    const page = storedText(pypi.objectStore, "repositories/python-internal/simple/alpha/index.html") ?? "";
    expect(page).toContain("alpha-1.0.tar.gz");
    expect(page).toContain("alpha-2.0.tar.gz");
  });

  it("does not list a file twice when it is published again", async () => {
    const pypi = await harness();

    await pypi.publish("pub_1", ["alpha-1.0.tar.gz"]);
    await pypi.publish("pub_2", ["alpha-1.0.tar.gz"]);

    const page = storedText(pypi.objectStore, "repositories/python-internal/simple/alpha/index.html") ?? "";
    expect(page.match(/alpha-1\.0\.tar\.gz<\/a>/g)).toHaveLength(1);
  });

  it("states the python requirement the distribution declared", async () => {
    const objectStore = new MemoryRepositoryObjectStore();
    const plugin = createPypiPlugin({ objectStoreFor: () => objectStore });
    await objectStore.putBytes(
      "_staging/uploads/pub_1/upl_1/thing-1.0-py3-none-any.whl",
      wheelBytes({
        name: "thing",
        version: "1.0",
        metadata: "Name: thing\nVersion: 1.0\nRequires-Python: >=3.11\n",
      }),
      "application/octet-stream",
    );

    await plugin.publish.finalize(publishInput("pub_1", ["thing-1.0-py3-none-any.whl"]));

    const page = storedText(objectStore, "repositories/python-internal/simple/thing/index.html") ?? "";
    expect(page).toContain('data-requires-python="&gt;=3.11"');
  });

  it("leaves an untouched project's page alone", async () => {
    // Rewriting every page on every publish would cost a write apiece to store
    // bytes already there.
    const pypi = await harness();
    await pypi.publish("pub_1", ["alpha-1.0.tar.gz"]);
    const before = writeCount(pypi.objectStore, "repositories/python-internal/simple/alpha/index.html");

    await pypi.publish("pub_2", ["beta-1.0.tar.gz"]);

    expect(writeCount(pypi.objectStore, "repositories/python-internal/simple/alpha/index.html"))
      .toBe(before);
  });

  it("publishes the core metadata beside the distribution", async () => {
    // PEP 658: pip resolves dependencies from this instead of downloading the
    // whole wheel, which for a large one is the difference between kilobytes
    // and hundreds of megabytes.
    const pypi = await harness();

    await pypi.publish("pub_1", ["my_project-1.0-py3-none-any.whl"]);

    const metadata = storedText(
      pypi.objectStore,
      "repositories/python-internal/packages/my-project/my_project-1.0-py3-none-any.whl.metadata",
    );
    expect(metadata).toContain("Name: my_project");
    expect(storedText(pypi.objectStore, "repositories/python-internal/simple/my-project/index.html"))
      .toContain('data-core-metadata="sha256=');
  });

  it("publishes both serializations of a project page", async () => {
    const pypi = await harness();

    await pypi.publish("pub_1", ["alpha-1.0.tar.gz"]);

    const json = storedText(pypi.objectStore, "repositories/python-internal/simple/alpha/index.v1.json") ?? "";
    expect(JSON.parse(json)).toMatchObject({
      meta: { "api-version": "1.0" },
      name: "alpha",
      files: [expect.objectContaining({ filename: "alpha-1.0.tar.gz" })],
    });
  });

  it("describes the same files in HTML and in JSON", async () => {
    // The two are generated from one list, and a client picks between them by
    // Accept alone; if they disagreed, what pip installs would depend on which
    // it happened to ask for.
    const pypi = await harness();
    await pypi.publish("pub_1", ["alpha-1.0.tar.gz", "alpha-2.0-py3-none-any.whl"]);

    const html = storedText(pypi.objectStore, "repositories/python-internal/simple/alpha/index.html") ?? "";
    const json = JSON.parse(
      storedText(pypi.objectStore, "repositories/python-internal/simple/alpha/index.v1.json") ?? "{}",
    ) as { files: Array<{ filename: string; hashes: { sha256: string } }> };

    for (const file of json.files) {
      expect(html).toContain(file.filename);
      expect(html).toContain(`#sha256=${file.hashes.sha256}`);
    }
    expect(json.files).toHaveLength(2);
  });

  it("refuses a file whose contents are a different project than its name", async () => {
    // The filename is what puts a file on a project page. A wheel named after
    // Django, containing something else, would be handed to everyone who asks
    // pip for Django — so the package's own record of itself has to agree.
    const objectStore = new MemoryRepositoryObjectStore();
    const plugin = createPypiPlugin({ objectStoreFor: () => objectStore });
    await objectStore.putBytes(
      "_staging/uploads/pub_1/upl_1/django-5.0.tar.gz",
      await sdistBytes({ name: "django", version: "5.0", metadata: "Name: impostor\nVersion: 5.0\n" }),
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
