import { describe, expect, it } from "vitest";
import {
  normalizeProjectName,
  parseDistributionFilename,
  requireDistributionFilename,
} from "./names";

describe("normalizeProjectName", () => {
  // The examples PEP 503 itself gives.
  it.each([
    ["Foo", "foo"],
    ["foo", "foo"],
    ["Foo.Bar", "foo-bar"],
    ["foo_bar", "foo-bar"],
    ["Foo---Bar", "foo-bar"],
    ["zope.interface", "zope-interface"],
    ["ruamel.yaml.clib", "ruamel-yaml-clib"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeProjectName(input)).toBe(expected);
  });

  it("brings every spelling of one project to the same page", () => {
    // The whole point: these are one project, and an index keyed by anything
    // less than this would scatter its files across several pages.
    const spellings = ["Foo.Bar", "foo_bar", "FOO--BAR", "foo.BAR", "Foo_.-Bar"];

    expect(new Set(spellings.map(normalizeProjectName)).size).toBe(1);
  });
});

describe("parseDistributionFilename", () => {
  it("reads a wheel's project and version", () => {
    expect(parseDistributionFilename("simple-1.0-py3-none-any.whl")).toEqual({
      kind: "wheel",
      rawName: "simple",
      normalizedName: "simple",
      version: "1.0",
    });
  });

  it("reads a wheel that carries a build tag", () => {
    // The optional build tag sits between version and python tag, so a parser
    // that counts fields from the left reads the version as the build number.
    expect(parseDistributionFilename("simple-1.0-1-py3-none-any.whl")).toMatchObject({
      rawName: "simple",
      version: "1.0",
    });
  });

  it.each([
    "numpy-1.26.4-cp312-cp312-manylinux_2_17_x86_64.whl",
    "pkg-1.0-py2.py3-none-any.whl",
    "pkg-1.0-cp312-abi3-macosx_11_0_arm64.whl",
  ])("reads real-world wheel tags: %s", (filename) => {
    expect(parseDistributionFilename(filename)?.version).toBeTruthy();
  });

  it("unescapes a wheel's project name through normalization", () => {
    // A wheel spells `zope.interface` as `zope_interface`; both have to reach
    // the same page as the sdist, which spells it either way.
    expect(parseDistributionFilename("zope_interface-6.1-py3-none-any.whl")?.normalizedName)
      .toBe("zope-interface");
  });

  it("reads a source distribution", () => {
    expect(parseDistributionFilename("simple-1.0.tar.gz")).toEqual({
      kind: "sdist",
      rawName: "simple",
      normalizedName: "simple",
      version: "1.0",
    });
  });

  it("keeps the dashes in an older sdist's unescaped name", () => {
    // PEP 625 escaping is recent; sdists built before it spell the project
    // name as-is, dashes included, and the version is what follows the last one.
    expect(parseDistributionFilename("my-project-1.0.tar.gz")).toMatchObject({
      rawName: "my-project",
      normalizedName: "my-project",
      version: "1.0",
    });
  });

  it("puts a wheel and an sdist of one project on the same page", () => {
    const wheel = parseDistributionFilename("my_project-1.0-py3-none-any.whl");
    const sdist = parseDistributionFilename("my-project-1.0.tar.gz");

    expect(wheel?.normalizedName).toBe(sdist?.normalizedName);
  });

  it.each([
    ["a file that is not a distribution", "notes.txt"],
    ["a wheel missing its tags", "simple.whl"],
    ["a wheel missing its version", "simple-py3-none-any.whl"],
    ["a wheel with no project name", "-1.0-py3-none-any.whl"],
    ["an sdist with no version", "simple.tar.gz"],
    ["an archive that is not an sdist", "simple-1.0.zip"],
  ])("rejects %s", (_case, filename) => {
    expect(parseDistributionFilename(filename)).toBeUndefined();
  });

  it.each([
    ["..-1.0.tar.gz"],
    ["...-1.0-py3-none-any.whl"],
    ["___-1.0.tar.gz"],
    ["--1.0.tar.gz"],
  ])("rejects %s, which would normalize to something unaddressable", (filename) => {
    // These normalize to "-" or "", which cannot be a path segment. Accepting
    // one would put an index page at a key nothing can ask for, and a name
    // made only of dots is the shape a traversal attempt takes.
    expect(parseDistributionFilename(filename)).toBeUndefined();
  });

  it("never lets a parsed name escape its directory", () => {
    for (const filename of ["..-1.0.tar.gz", "._.-1.0.tar.gz", "..-1.0-py3-none-any.whl"]) {
      const parsed = parseDistributionFilename(filename);
      expect(parsed?.normalizedName ?? "").not.toContain(".");
      expect(parsed?.normalizedName ?? "").not.toContain("/");
    }
  });
});

describe("requireDistributionFilename", () => {
  it("rejects a filename that is not a distribution", () => {
    expect(() => requireDistributionFilename("notes.txt"))
      .toThrow(/not a wheel or source distribution/);
  });

  it("returns the parse for a good one", () => {
    expect(requireDistributionFilename("simple-1.0.tar.gz").normalizedName).toBe("simple");
  });
});
