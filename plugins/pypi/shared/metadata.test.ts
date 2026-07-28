import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { streamFromBytes, zipSourceFromBytes } from "@axis-repository/core/archives";
import {
  parseCoreMetadata,
  readSdistMetadata,
  readWheelMetadata,
  requireMetadataMatchesFilename,
} from "./metadata";
import { requireDistributionFilename } from "./names";

/** Runs a Python snippet, so fixtures are built by the tooling being parsed. */
function python(script: string, cwd: string): boolean {
  const scriptPath = path.join(cwd, "build.py");
  writeFileSync(scriptPath, script);
  for (const runtime of ["python3", "python"]) {
    try {
      execFileSync(runtime, [scriptPath], { cwd, stdio: "pipe" });
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

const WHEEL_METADATA = [
  "Metadata-Version: 2.1",
  "Name: My.Project",
  "Version: 1.0",
  "Requires-Python: >=3.9",
  "Summary: a summary",
  "",
  "Long description here.",
].join("\n");

function buildWheel(metadata = WHEEL_METADATA): Uint8Array | undefined {
  const dir = mkdtempSync(path.join(tmpdir(), "axis-whl-"));
  try {
    const built = python([
      "import zipfile",
      'z = zipfile.ZipFile("out.whl", "w", zipfile.ZIP_DEFLATED)',
      'z.writestr("my_project/__init__.py", "x = 1\\n")',
      `z.writestr("my_project-1.0.dist-info/METADATA", ${JSON.stringify(metadata)})`,
      'z.writestr("my_project-1.0.dist-info/WHEEL", "Wheel-Version: 1.0\\n")',
      "z.close()",
    ].join("\n"), dir);
    return built ? new Uint8Array(readFileSync(path.join(dir, "out.whl"))) : undefined;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function buildSdist(pkgInfo: string, extra = ""): Uint8Array | undefined {
  const dir = mkdtempSync(path.join(tmpdir(), "axis-sdist-"));
  try {
    const built = python([
      "import tarfile, io",
      't = tarfile.open("out.tar.gz", "w:gz")',
      "def add(name, text):",
      "    data = text.encode()",
      "    info = tarfile.TarInfo(name)",
      "    info.size = len(data)",
      "    t.addfile(info, io.BytesIO(data))",
      extra,
      `add("my-project-1.0/PKG-INFO", ${JSON.stringify(pkgInfo)})`,
      'add("my-project-1.0/setup.py", "# setup\\n")',
      "t.close()",
    ].join("\n"), dir);
    return built ? new Uint8Array(readFileSync(path.join(dir, "out.tar.gz"))) : undefined;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const SDIST_PKG_INFO = [
  "Metadata-Version: 2.1",
  "Name: my-project",
  "Version: 1.0",
  "Requires-Python: >=3.8",
  "",
  "Body.",
].join("\n");

describe("readWheelMetadata", () => {
  const wheel = buildWheel();

  it.skipIf(!wheel)("reads the project, version and python requirement", async () => {
    const metadata = await readWheelMetadata(zipSourceFromBytes(wheel!));

    expect(metadata).toMatchObject({
      name: "My.Project",
      version: "1.0",
      requiresPython: ">=3.9",
    });
  });

  it.skipIf(!wheel)("keeps the metadata document itself", async () => {
    // PEP 658 serves this alongside the wheel so pip can resolve without
    // downloading it, so it has to survive parsing unchanged.
    const metadata = await readWheelMetadata(zipSourceFromBytes(wheel!));

    expect(metadata.text).toBe(WHEEL_METADATA);
  });

  it("rejects a zip with no dist-info metadata", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "axis-bad-"));
    try {
      const built = python([
        "import zipfile",
        'z = zipfile.ZipFile("out.whl", "w")',
        'z.writestr("something.txt", "not a wheel")',
        "z.close()",
      ].join("\n"), dir);
      if (!built) return;

      await expect(readWheelMetadata(zipSourceFromBytes(new Uint8Array(readFileSync(path.join(dir, "out.whl"))))))
        .rejects.toThrow(/dist-info\/METADATA/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("readSdistMetadata", () => {
  const sdist = buildSdist(SDIST_PKG_INFO);

  it.skipIf(!sdist)("reads the project and version out of PKG-INFO", async () => {
    const metadata = await readSdistMetadata(streamFromBytes(sdist!));

    expect(metadata).toMatchObject({ name: "my-project", version: "1.0", requiresPython: ">=3.8" });
  });

  it("ignores a PKG-INFO that is not the distribution's own", async () => {
    // A vendored package or a test fixture can carry its own PKG-INFO deeper
    // in the tree; taking the first one found would read the wrong project.
    const sdistWithVendored = buildSdist(
      SDIST_PKG_INFO,
      'add("my-project-1.0/vendor/other/PKG-INFO", "Metadata-Version: 2.1\\nName: impostor\\nVersion: 9.9\\n")',
    );
    if (!sdistWithVendored) return;

    const metadata = await readSdistMetadata(streamFromBytes(sdistWithVendored));

    expect(metadata.name).toBe("my-project");
  });

  it("rejects a tarball with no PKG-INFO", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "axis-nopkg-"));
    try {
      const built = python([
        "import tarfile, io",
        't = tarfile.open("out.tar.gz", "w:gz")',
        "data = b'# nothing'",
        'info = tarfile.TarInfo("my-project-1.0/setup.py")',
        "info.size = len(data)",
        "t.addfile(info, io.BytesIO(data))",
        "t.close()",
      ].join("\n"), dir);
      if (!built) return;

      await expect(readSdistMetadata(streamFromBytes(new Uint8Array(readFileSync(path.join(dir, "out.tar.gz"))))))
        .rejects.toThrow(/PKG-INFO/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("parseCoreMetadata", () => {
  it("stops at the blank line that starts the description", () => {
    // The long description is a README. A line in it that looks like a header
    // must not become one: "Requires-Python: >=99" in prose would otherwise
    // make pip skip this file for every user, and no field already set could
    // shadow it because the headers never mentioned it.
    const metadata = parseCoreMetadata([
      "Metadata-Version: 2.1",
      "Name: real",
      "Version: 1.0",
      "",
      "Usage notes:",
      "Requires-Python: >=99",
      "Name: impostor",
    ].join("\n"));

    expect(metadata).toMatchObject({ name: "real", version: "1.0" });
    expect(metadata.requiresPython).toBeUndefined();
  });

  it("keeps the first value when a field repeats", () => {
    expect(parseCoreMetadata("Name: first\nName: second\nVersion: 1.0\n").name).toBe("first");
  });

  it("reads headers whatever case they are written in", () => {
    expect(parseCoreMetadata("NAME: thing\nversion: 2.0\n")).toMatchObject({
      name: "thing",
      version: "2.0",
    });
  });

  it("rejects metadata that names no project", () => {
    expect(() => parseCoreMetadata("Metadata-Version: 2.1\nVersion: 1.0\n"))
      .toThrow(/does not name a project and version/);
  });
});

describe("requireMetadataMatchesFilename", () => {
  it("accepts a filename that spells the project differently", () => {
    // The wheel says My.Project, the filename says my_project: one project.
    expect(() => requireMetadataMatchesFilename(
      parseCoreMetadata("Name: My.Project\nVersion: 1.0\n"),
      requireDistributionFilename("my_project-1.0-py3-none-any.whl"),
    )).not.toThrow();
  });

  it("rejects a file whose contents are a different project", () => {
    // Otherwise a file named after Django, containing something else, is
    // offered to everyone who asks pip for Django.
    expect(() => requireMetadataMatchesFilename(
      parseCoreMetadata("Name: impostor\nVersion: 5.0\n"),
      requireDistributionFilename("django-5.0.tar.gz"),
    )).toThrow(/says django but its metadata says impostor/);
  });

  it("rejects a file whose contents are a different version", () => {
    expect(() => requireMetadataMatchesFilename(
      parseCoreMetadata("Name: thing\nVersion: 9.9\n"),
      requireDistributionFilename("thing-1.0.tar.gz"),
    )).toThrow(/version 1.0 but its metadata says 9.9/);
  });

  it("accepts a version a wheel had to escape", () => {
    // A wheel cannot put `-` in a version field, so 1.0-beta is spelled
    // 1.0_beta in the filename.
    expect(() => requireMetadataMatchesFilename(
      parseCoreMetadata("Name: thing\nVersion: 1.0-beta\n"),
      requireDistributionFilename("thing-1.0_beta-py3-none-any.whl"),
    )).not.toThrow();
  });
});
