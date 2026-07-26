import { describe, expect, it } from "vitest";
import { readDebFilePaths } from "../shared/deb-files";
import { debArchive } from "./deb-fixtures.test-support";
import {
  formatContentsIndex,
  mergeContentsIndex,
  parseContentsIndex,
  qualifiedContentsName,
} from "./contents";

const control = [
  "Package: myapp",
  "Version: 1.2.3",
  "Architecture: amd64",
  "Maintainer: Release Team <release@example.com>",
  "Description: Example package",
  "",
].join("\n");

describe("reading the files a package installs", () => {
  it("lists regular files without the leading ./ that dpkg writes", async () => {
    const deb = debArchive({ control, files: ["usr/bin/myapp", "etc/myapp/config.toml"] });

    await expect(readDebFilePaths(deb)).resolves.toEqual([
      "usr/bin/myapp",
      "etc/myapp/config.toml",
    ]);
  });

  it("reads a zstd data archive, which is what dpkg now writes by default", async () => {
    const deb = debArchive({ control, files: ["usr/bin/myapp"], dataCompression: "zstd" });

    await expect(readDebFilePaths(deb)).resolves.toEqual(["usr/bin/myapp"]);
  });

  it("reads an uncompressed data archive", async () => {
    const deb = debArchive({ control, files: ["usr/bin/myapp"], dataCompression: "none" });

    await expect(readDebFilePaths(deb)).resolves.toEqual(["usr/bin/myapp"]);
  });

  it("returns nothing for a package that installs no files", async () => {
    await expect(readDebFilePaths(debArchive({ control }))).resolves.toEqual([]);
  });
});

describe("Contents index", () => {
  it("names a package the way apt-file expects, with the component outside main", () => {
    expect(qualifiedContentsName({ packageName: "myapp", component: "main", section: "utils" }))
      .toBe("utils/myapp");
    expect(qualifiedContentsName({ packageName: "myapp", component: "contrib", section: "utils" }))
      .toBe("contrib/utils/myapp");
    // A package with no Section still needs a two-part name to parse.
    expect(qualifiedContentsName({ packageName: "myapp", component: "main" })).toBe("misc/myapp");
  });

  it("writes one line per path, listing every package that installs it", () => {
    const contents = new Map([
      ["utils/myapp", ["usr/bin/myapp", "usr/share/doc/myapp/README"]],
      ["utils/otherapp", ["usr/share/doc/myapp/README"]],
    ]);

    expect(formatContentsIndex(contents)).toBe([
      "usr/bin/myapp utils/myapp",
      "usr/share/doc/myapp/README utils/myapp,utils/otherapp",
      "",
    ].join("\n"));
  });

  it("round-trips through the published form", () => {
    const contents = new Map([
      ["utils/myapp", ["usr/bin/myapp"]],
      ["utils/otherapp", ["usr/bin/otherapp", "usr/bin/myapp"]],
    ]);

    const parsed = parseContentsIndex(formatContentsIndex(contents) ?? "");

    expect(parsed.get("utils/myapp")).toEqual(["usr/bin/myapp"]);
    expect(parsed.get("utils/otherapp")?.sort()).toEqual(["usr/bin/myapp", "usr/bin/otherapp"]);
  });

  it("reads a path containing spaces, since the package column is the last one", () => {
    const parsed = parseContentsIndex("usr/share/doc/my app/README utils/myapp\n");

    expect(parsed.get("utils/myapp")).toEqual(["usr/share/doc/my app/README"]);
  });

  it("is omitted when no package installs anything", () => {
    expect(formatContentsIndex(new Map())).toBeUndefined();
    expect(formatContentsIndex(new Map([["utils/myapp", []]]))).toBeUndefined();
  });

  it("keeps untouched packages, replaces republished ones, and drops removed ones", () => {
    const merged = mergeContentsIndex({
      existing: new Map([
        ["utils/kept", ["usr/bin/kept"]],
        ["utils/myapp", ["usr/bin/old-name"]],
        ["utils/removed", ["usr/bin/removed"]],
      ]),
      // A new version installs a different set of files, so the incoming list
      // replaces rather than adds to what was there.
      incoming: new Map([["utils/myapp", ["usr/bin/new-name"]]]),
      keepNames: new Set(["utils/kept", "utils/myapp"]),
    });

    expect([...merged.keys()].sort()).toEqual(["utils/kept", "utils/myapp"]);
    expect(merged.get("utils/myapp")).toEqual(["usr/bin/new-name"]);
    expect(merged.get("utils/kept")).toEqual(["usr/bin/kept"]);
  });
});
