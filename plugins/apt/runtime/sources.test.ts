import { describe, expect, it } from "vitest";
import { ValidationError } from "@axis-repository/core";
import { md5Hex } from "../shared/md5";
import { parseStanzas, stanzaField } from "../shared/stanza";
import {
  buildSourceStanza,
  formatSourcesIndex,
  mergeSourceStanzas,
  parseDsc,
  sourceStanzaFilenames,
  stripClearsign,
} from "./sources";

const textEncoder = new TextEncoder();

const dscBody = [
  "Format: 3.0 (quilt)",
  "Source: myapp",
  "Binary: myapp",
  "Architecture: any",
  "Version: 1.2.3-1",
  "Maintainer: Release Team <release@example.com>",
  "Standards-Version: 4.6.0",
  "Checksums-Sha1:",
  " 1111111111111111111111111111111111111111 4096 myapp_1.2.3.orig.tar.xz",
  " 2222222222222222222222222222222222222222 512 myapp_1.2.3-1.debian.tar.xz",
  "Checksums-Sha256:",
  ` ${"a".repeat(64)} 4096 myapp_1.2.3.orig.tar.xz`,
  ` ${"b".repeat(64)} 512 myapp_1.2.3-1.debian.tar.xz`,
  "Files:",
  ` ${"c".repeat(32)} 4096 myapp_1.2.3.orig.tar.xz`,
  ` ${"d".repeat(32)} 512 myapp_1.2.3-1.debian.tar.xz`,
  "",
].join("\n");

function clearsigned(body: string): string {
  return [
    "-----BEGIN PGP SIGNED MESSAGE-----",
    "Hash: SHA512",
    "",
    body.trimEnd(),
    "-----BEGIN PGP SIGNATURE-----",
    "",
    "iQIzBAEBCgAd...",
    "-----END PGP SIGNATURE-----",
    "",
  ].join("\n");
}

async function stanzaFor(text: string) {
  const bytes = textEncoder.encode(text);
  return buildSourceStanza({
    dsc: parseDsc(bytes),
    dscFile: { name: "myapp_1.2.3-1.dsc", size: bytes.byteLength, bytes },
    component: "main",
    directory: "pool/main/myapp",
  });
}

describe("reading a .dsc", () => {
  it("reads the source name, version and the files it points at", () => {
    const dsc = parseDsc(textEncoder.encode(dscBody));

    expect(dsc.sourceName).toBe("myapp");
    expect(dsc.version).toBe("1.2.3-1");
    expect(dsc.files).toEqual([
      { name: "myapp_1.2.3.orig.tar.xz", size: 4096, sha1: "1".repeat(40), sha256: "a".repeat(64), md5: "c".repeat(32) },
      { name: "myapp_1.2.3-1.debian.tar.xz", size: 512, sha1: "2".repeat(40), sha256: "b".repeat(64), md5: "d".repeat(32) },
    ]);
  });

  it("reads a clearsigned .dsc, which is how dpkg-source writes one", () => {
    expect(parseDsc(textEncoder.encode(clearsigned(dscBody))).sourceName).toBe("myapp");
  });

  it("undoes the dash-escaping a clearsigned body uses", () => {
    const escaped = clearsigned("Source: myapp\n- -----not a signature marker\nVersion: 1.0");

    expect(stripClearsign(escaped)).toContain("\n-----not a signature marker\n");
  });

  it("rejects a signature block it cannot find the end of", () => {
    const truncated = "-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA512\n\nSource: myapp\n";

    expect(() => parseDsc(textEncoder.encode(truncated))).toThrow(ValidationError);
  });

  it("requires the fields a Sources stanza is built from", () => {
    expect(() => parseDsc(textEncoder.encode("Format: 3.0 (quilt)\nVersion: 1.0\n")))
      .toThrow("APT source .dsc is missing Source");
    expect(() => parseDsc(textEncoder.encode("Format: 3.0 (quilt)\nSource: myapp\n")))
      .toThrow("APT source .dsc is missing Version");
  });
});

describe("Sources stanza", () => {
  it("renames Source to Package and adds the pool directory", async () => {
    const stanza = await stanzaFor(dscBody);

    expect(stanzaField(stanza, "Package")).toBe("myapp");
    expect(stanzaField(stanza, "Source")).toBeUndefined();
    expect(stanzaField(stanza, "Version")).toBe("1.2.3-1");
    expect(stanzaField(stanza, "Directory")).toBe("pool/main/myapp");
  });

  it("adds the .dsc to every checksum list, since it never lists itself", async () => {
    const bytes = textEncoder.encode(dscBody);
    const stanza = await stanzaFor(dscBody);

    expect(stanzaField(stanza, "Files")).toContain(`${md5Hex(bytes)} ${bytes.byteLength} myapp_1.2.3-1.dsc`);
    expect(stanzaField(stanza, "Checksums-Sha256")?.split("\n")).toHaveLength(3);
    expect(stanzaField(stanza, "Checksums-Sha256")).toContain(`${"a".repeat(64)} 4096 myapp_1.2.3.orig.tar.xz`);
  });

  it("names the pool paths apt has to fetch", async () => {
    expect(sourceStanzaFilenames(await stanzaFor(dscBody))).toEqual([
      "pool/main/myapp/myapp_1.2.3-1.dsc",
      "pool/main/myapp/myapp_1.2.3.orig.tar.xz",
      "pool/main/myapp/myapp_1.2.3-1.debian.tar.xz",
    ]);
  });

  it("replaces a source package republished at the same version", async () => {
    const first = await stanzaFor(dscBody);
    const second = await stanzaFor(dscBody.replace("Standards-Version: 4.6.0", "Standards-Version: 4.7.0"));

    const merged = mergeSourceStanzas([first], [second]);

    expect(merged).toHaveLength(1);
    expect(stanzaField(merged[0]!, "Standards-Version")).toBe("4.7.0");
  });

  it("keeps a different version alongside", async () => {
    const first = await stanzaFor(dscBody);
    const second = await stanzaFor(dscBody.replace("Version: 1.2.3-1", "Version: 1.2.4-1"));

    expect(mergeSourceStanzas([first], [second])).toHaveLength(2);
  });

  it("round-trips through the published index", async () => {
    const stanza = await stanzaFor(dscBody);

    const published = parseStanzas(formatSourcesIndex([stanza]) ?? "");

    expect(published).toHaveLength(1);
    expect(stanzaField(published[0]!, "Package")).toBe("myapp");
    expect(sourceStanzaFilenames(published[0]!)).toEqual(sourceStanzaFilenames(stanza));
  });

  it("is omitted when a component publishes no source packages", () => {
    expect(formatSourcesIndex([])).toBeUndefined();
  });
});
