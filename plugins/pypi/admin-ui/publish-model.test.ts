import { describe, expect, it } from "vitest";
import { sdistBytes, wheelBytes } from "@axis-repository/plugin-pypi/test-support";
import {
  buildPypiPublishArtifact,
  pypiCanPublishArtifact,
  pypiIsAcceptedFile,
  readPypiPublishMetadata,
} from "./publish-model";

function fileOf(name: string, bytes: Uint8Array): File {
  return new File([bytes as unknown as BlobPart], name);
}

describe("pypiIsAcceptedFile", () => {
  it.each([
    "my_project-1.0-py3-none-any.whl",
    "my-project-1.0.tar.gz",
  ])("accepts %s", (name) => {
    expect(pypiIsAcceptedFile({ name })).toBe(true);
  });

  it.each([
    "notes.txt",
    "my-project-1.0.zip",
    "..-1.0.tar.gz",
  ])("refuses %s", (name) => {
    expect(pypiIsAcceptedFile({ name })).toBe(false);
  });
});

describe("readPypiPublishMetadata", () => {
  it("reads a wheel's project and version in the browser", async () => {
    const file = fileOf(
      "my_project-1.0-py3-none-any.whl",
      wheelBytes({ name: "my_project", version: "1.0" }),
    );

    await expect(readPypiPublishMetadata(file)).resolves.toMatchObject({
      kind: "wheel",
      project: "my-project",
      version: "1.0",
    });
  });

  it("reads a source distribution", async () => {
    const file = fileOf("alpha-2.0.tar.gz", await sdistBytes({ name: "alpha", version: "2.0" }));

    await expect(readPypiPublishMetadata(file)).resolves.toMatchObject({
      kind: "sdist",
      project: "alpha",
      version: "2.0",
    });
  });

  it("reports a file whose contents are a different project than its name", async () => {
    // The worker refuses this too, but finding out here means the operator is
    // told while still looking at the file rather than after a failed publish.
    const file = fileOf(
      "django-5.0.tar.gz",
      await sdistBytes({ name: "django", version: "5.0", metadata: "Name: impostor\nVersion: 5.0\n" }),
    );

    await expect(readPypiPublishMetadata(file)).rejects.toThrow(/django but its metadata says impostor/);
  });

  it("reports a file that is not a distribution at all", async () => {
    await expect(readPypiPublishMetadata(fileOf("notes.txt", new TextEncoder().encode("hello"))))
      .rejects.toThrow(/not a wheel or source distribution/);
  });
});

describe("buildPypiPublishArtifact", () => {
  it("declares the file's own size and digest", async () => {
    // The session verifies the upload against these, so anything invented here
    // fails at verification instead of publishing.
    const bytes = await sdistBytes({ name: "alpha", version: "1.0" });
    const file = fileOf("alpha-1.0.tar.gz", bytes);

    const artifact = await buildPypiPublishArtifact(file);

    expect(artifact.filename).toBe("alpha-1.0.tar.gz");
    expect(artifact.size).toBe(bytes.byteLength);
    expect(artifact.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("pypiCanPublishArtifact", () => {
  const metadata = { kind: "sdist" as const, project: "alpha", version: "1.0" };
  const file = fileOf("alpha-1.0.tar.gz", new Uint8Array(1));

  it("needs a file, its metadata, and no error", () => {
    expect(pypiCanPublishArtifact({ file, metadata, error: "", isPublishing: false })).toBe(true);
  });

  it.each([
    ["no file", { file: undefined, metadata, error: "", isPublishing: false }],
    ["unreadable metadata", { file, metadata: undefined, error: "", isPublishing: false }],
    ["a reported error", { file, metadata, error: "bad", isPublishing: false }],
    ["a publish in flight", { file, metadata, error: "", isPublishing: true }],
  ])("refuses with %s", (_case, input) => {
    expect(pypiCanPublishArtifact(input)).toBe(false);
  });
});
