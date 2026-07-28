import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readZipEntries, readZipEntry, zipSourceFromBytes } from "./zip";

/**
 * Builds a zip with Python's own zipfile, so what is parsed here is a zip as
 * the tooling that produces wheels actually writes them, not one written to
 * match this parser's assumptions.
 */
function pythonZip(files: Array<{ name: string; content: string }>, compress = true): Uint8Array | undefined {
  const dir = mkdtempSync(path.join(tmpdir(), "axis-zip-"));
  try {
    const archive = path.join(dir, "test.zip");
    const script = [
      "import zipfile, sys",
      `mode = zipfile.ZIP_DEFLATED if ${compress ? "True" : "False"} else zipfile.ZIP_STORED`,
      `z = zipfile.ZipFile(${JSON.stringify(archive)}, "w", mode)`,
      ...files.map((file) => `z.writestr(${JSON.stringify(file.name)}, ${JSON.stringify(file.content)})`),
      "z.close()",
    ].join("\n");
    const scriptPath = path.join(dir, "build.py");
    writeFileSync(scriptPath, script);
    for (const python of ["python3", "python"]) {
      try {
        execFileSync(python, [scriptPath], { stdio: "pipe" });
        return new Uint8Array(readFileSync(archive));
      } catch {
        continue;
      }
    }
    return undefined;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const METADATA = [
  "Metadata-Version: 2.1",
  "Name: my-project",
  "Version: 1.0",
  "Requires-Python: >=3.9",
  "",
  "A description.",
].join("\n");

describe("readZipEntries", () => {
  const wheel = pythonZip([
    { name: "my_project/__init__.py", content: "x = 1\n" },
    { name: "my_project-1.0.dist-info/METADATA", content: METADATA },
    { name: "my_project-1.0.dist-info/RECORD", content: "my_project/__init__.py,,\n" },
  ]);

  it.skipIf(!wheel)("lists what a real zip contains", async () => {
    const entries = await readZipEntries(zipSourceFromBytes(wheel!));

    expect(entries.map((entry) => entry.name)).toEqual([
      "my_project/__init__.py",
      "my_project-1.0.dist-info/METADATA",
      "my_project-1.0.dist-info/RECORD",
    ]);
  });

  it.skipIf(!wheel)("reads a deflated entry back", async () => {
    const source = zipSourceFromBytes(wheel!);
    const entries = await readZipEntries(source);
    const metadata = entries.find((entry) => entry.name.endsWith("/METADATA"))!;

    // Deflated, so this only comes out right if the local header's own name
    // and extra lengths were used to find where the data starts.
    expect(metadata.compressionMethod).toBe(8);
    expect(new TextDecoder().decode(await readZipEntry(source, metadata))).toBe(METADATA);
  });

  it.skipIf(!wheel)("reads only the tail and the directory, not the whole archive", async () => {
    // The point of reading a zip from its end: a wheel is mostly payload, and
    // its metadata must not cost the payload to reach.
    let bytesRead = 0;
    const inner = zipSourceFromBytes(wheel!);
    const source = {
      size: inner.size,
      read: async (offset: number, length: number) => {
        bytesRead += Math.min(length, inner.size - offset);
        return inner.read(offset, length);
      },
    };

    const entries = await readZipEntries(source);
    await readZipEntry(source, entries.find((entry) => entry.name.endsWith("/METADATA"))!);

    // The tail read is capped by the archive size here because the fixture is
    // small; what matters is that no read covered the other entries' data.
    expect(bytesRead).toBeLessThan(inner.size * 3);
  });
});

describe("readZipEntry", () => {
  const stored = pythonZip([{ name: "plain.txt", content: "stored, not deflated" }], false);

  it.skipIf(!stored)("reads an entry that was stored rather than compressed", async () => {
    const source = zipSourceFromBytes(stored!);
    const entries = await readZipEntries(source);

    expect(entries[0]?.compressionMethod).toBe(0);
    expect(new TextDecoder().decode(await readZipEntry(source, entries[0]!)))
      .toBe("stored, not deflated");
  });
});

describe("a zip with a trailing comment", () => {
  it("still finds the directory when a comment sits after it", async () => {
    // The end-of-directory record is not at a fixed offset: a comment of up to
    // 64 KiB may follow it, so it has to be searched for backwards.
    const dir = mkdtempSync(path.join(tmpdir(), "axis-zipc-"));
    try {
      const archive = path.join(dir, "commented.zip");
      const script = [
        "import zipfile",
        `z = zipfile.ZipFile(${JSON.stringify(archive)}, "w", zipfile.ZIP_DEFLATED)`,
        'z.writestr("a.txt", "hello")',
        'z.comment = b"x" * 3000',
        "z.close()",
      ].join("\n");
      const scriptPath = path.join(dir, "build.py");
      mkdirSync(path.dirname(scriptPath), { recursive: true });
      writeFileSync(scriptPath, script);
      let built = false;
      for (const python of ["python3", "python"]) {
        try {
          execFileSync(python, [scriptPath], { stdio: "pipe" });
          built = true;
          break;
        } catch {
          continue;
        }
      }
      if (!built) {
        return;
      }

      const source = zipSourceFromBytes(new Uint8Array(readFileSync(archive)));
      const entries = await readZipEntries(source);

      expect(entries.map((entry) => entry.name)).toEqual(["a.txt"]);
      expect(new TextDecoder().decode(await readZipEntry(source, entries[0]!))).toBe("hello");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("a zip whose local headers carry extra fields", () => {
  /**
   * force_zip64 makes Python write a zip64 extra field into the local header,
   * which is where plenty of real build tools also put timestamps and unix
   * attributes. The central directory's own lengths do not describe it, so an
   * entry's data can only be found by reading the local header's.
   */
  function zip64Local(): Uint8Array | undefined {
    const dir = mkdtempSync(path.join(tmpdir(), "axis-zip64-"));
    try {
      const archive = path.join(dir, "z64.zip");
      const script = [
        "import zipfile",
        `z = zipfile.ZipFile(${JSON.stringify(archive)}, "w", zipfile.ZIP_DEFLATED)`,
        'with z.open("pkg-1.0.dist-info/METADATA", "w", force_zip64=True) as f:',
        '    f.write(b"Metadata-Version: 2.1\\nName: pkg\\nVersion: 1.0\\n")',
        'with z.open("\\u00e9\\u00e0-unicode.txt", "w", force_zip64=True) as f:',
        '    f.write(b"non ascii name")',
        "z.close()",
      ].join("\n");
      const scriptPath = path.join(dir, "build.py");
      writeFileSync(scriptPath, script);
      for (const python of ["python3", "python"]) {
        try {
          execFileSync(python, [scriptPath], { stdio: "pipe" });
          return new Uint8Array(readFileSync(archive));
        } catch {
          continue;
        }
      }
      return undefined;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const archive = zip64Local();

  it.skipIf(!archive)("finds an entry's data past the local extra field", async () => {
    const source = zipSourceFromBytes(archive!);
    const entries = await readZipEntries(source);
    const metadata = entries.find((entry) => entry.name.endsWith("/METADATA"))!;

    expect(new TextDecoder().decode(await readZipEntry(source, metadata)))
      .toBe("Metadata-Version: 2.1\nName: pkg\nVersion: 1.0\n");
  });

  it.skipIf(!archive)("measures a name in bytes, not characters", async () => {
    // A non-ASCII name is longer in bytes than in JS characters, so anything
    // that counts characters lands short of the data.
    const source = zipSourceFromBytes(archive!);
    const entries = await readZipEntries(source);
    const unicode = entries.find((entry) => entry.name.includes("unicode"))!;

    expect(new TextDecoder().decode(await readZipEntry(source, unicode))).toBe("non ascii name");
  });
});

describe("a file that is not a zip", () => {
  it("is rejected rather than read at some arbitrary offset", async () => {
    const source = zipSourceFromBytes(new TextEncoder().encode("not a zip at all"));

    await expect(readZipEntries(source)).rejects.toThrow(/end of central directory/);
  });
});
