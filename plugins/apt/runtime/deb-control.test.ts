import { describe, expect, it } from "vitest";
import { readDebControlMetadata } from "./deb-control";
import { debArchive, debArchiveWithControlXz } from "./deb-fixtures.test-support";

const textEncoder = new TextEncoder();

describe("Debian package control metadata", () => {
  it("reads control metadata from a Debian package archive", async () => {
    const deb = debArchive({
      control: [
        "Package: myapp",
        "Version: 1.2.3",
        "Architecture: amd64",
        "Maintainer: Release Team <release@example.com>",
        "Description: Example package",
        " more details",
        " .",
        " and a second paragraph",
        "Depends: libc6,",
        " libssl3",
        "",
      ].join("\n"),
    });

    await expect(readDebControlMetadata(deb)).resolves.toEqual({
      package: "myapp",
      version: "1.2.3",
      architecture: "amd64",
      maintainer: "Release Team <release@example.com>",
      // The short summary, the extended description and its paragraph break
      // all survive; apt shows the long form from these lines.
      description: "Example package\n more details\n .\n and a second paragraph",
      // Wrapping in a dependency list is only formatting, so it is folded back.
      depends: "libc6, libssl3",
    });
  });

  it("reads control metadata from a Debian package archive with xz-compressed control metadata", async () => {
    const deb = await debArchiveWithControlXz({
      control: [
        "Package: myapp",
        "Version: 1.2.3",
        "Architecture: amd64",
        "Maintainer: Release Team <release@example.com>",
        "Description: Example package",
        "Depends: libc6",
        "",
      ].join("\n"),
    });

    await expect(readDebControlMetadata(deb)).resolves.toMatchObject({
      package: "myapp",
      version: "1.2.3",
      architecture: "amd64",
      maintainer: "Release Team <release@example.com>",
      depends: "libc6",
    });
  });

  it("rejects archives without supported control metadata", async () => {
    await expect(readDebControlMetadata(textEncoder.encode("not a deb"))).rejects.toThrow(
      "APT artifact is not a Debian package archive",
    );
  });
});
