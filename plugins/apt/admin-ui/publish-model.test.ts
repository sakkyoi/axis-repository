import { describe, expect, it } from "vitest";

import type { PublishSession } from "@axis-repository/admin-ui/plugin-ui";
import {
  aptPublishSessionArtifactSummary,
  buildAptPublishArtifact,
  readAptPublishPackageMetadata,
} from "./publish-model";

const textEncoder = new TextEncoder();

describe("APT publish model", () => {
  it("builds APT publish artifact metadata from Debian package control fields", async () => {
    const bytes = debArchive({
      control: [
        "Package: myapp",
        "Version: 1.2.3",
        "Architecture: arm64",
        "Maintainer: Release Team <release@example.com>",
        "Description: My app",
        "Section: utils",
        "Priority: optional",
        "Depends: libc6",
      ].join("\n"),
    });
    const file = new File([arrayBufferFromBytes(bytes)], "myapp_1.2.3_arm64.deb", {
      type: "application/vnd.debian.binary-package",
    });

    await expect(
      buildAptPublishArtifact(file, {
        component: "main",
      }),
    ).resolves.toMatchObject({
      filename: "myapp_1.2.3_arm64.deb",
      size: bytes.byteLength,
      contentType: "application/vnd.debian.binary-package",
      metadata: {
        package: "myapp",
        version: "1.2.3",
        architecture: "arm64",
        component: "main",
        description: "My app",
        maintainer: "Release Team <release@example.com>",
        section: "utils",
        priority: "optional",
        depends: "libc6",
      },
    });
  });

  it("reads APT publish metadata for display from Debian package control fields", async () => {
    const bytes = debArchive({
      control: [
        "Package: myapp",
        "Version: 1.2.3",
        "Architecture: all",
        "Maintainer: Release Team <release@example.com>",
        "Description: My app",
      ].join("\n"),
    });
    const file = new File([arrayBufferFromBytes(bytes)], "custom-name.deb");

    await expect(readAptPublishPackageMetadata(file)).resolves.toMatchObject({
      packageName: "myapp",
      version: "1.2.3",
      architecture: "all",
      maintainer: "Release Team <release@example.com>",
      description: "My app",
    });
  });

  it("summarizes single APT package sessions from plugin metadata", () => {
    expect(aptPublishSessionArtifactSummary(session())).toBe("myapp 1.2.3 amd64, 0 verified");
  });
});

function session(): PublishSession {
  return {
    id: "pub_apt",
    repositoryName: "debian-internal",
    ecosystem: "apt",
    status: "finalized",
    requestedBy: {
      tokenId: "tok_1",
      name: "ci",
      permissions: ["publish"],
      repositories: ["debian-internal"],
      ecosystemScopes: {},
      signingKeyIds: [],
    },
    artifacts: [{
      filename: "myapp_1.2.3_amd64.deb",
      size: 1234,
      sha256: "a".repeat(64),
      contentType: "application/vnd.debian.binary-package",
      metadata: { package: "myapp", version: "1.2.3", architecture: "amd64" },
    }],
    uploads: [],
    verifiedUploads: [],
    createdAt: "2026-07-23T00:00:00.000Z",
    expiresAt: "2026-07-23T00:10:00.000Z",
  };
}

function debArchive(input: { control: string }): Uint8Array {
  return arArchive([
    { name: "debian-binary", bytes: textEncoder.encode("2.0\n") },
    { name: "control.tar", bytes: tarArchive([{ name: "./control", bytes: textEncoder.encode(input.control) }]) },
    { name: "data.tar", bytes: tarArchive([]) },
  ]);
}

function arArchive(entries: Array<{ name: string; bytes: Uint8Array }>): Uint8Array {
  const chunks: Uint8Array[] = [textEncoder.encode("!<arch>\n")];
  for (const entry of entries) {
    const name = `${entry.name}/`.padEnd(16, " ");
    const header = `${name}${"0".padEnd(12, " ")}${"0".padEnd(6, " ")}${"0".padEnd(6, " ")}${"100644".padEnd(8, " ")}${String(entry.bytes.byteLength).padEnd(10, " ")}\`\n`;
    chunks.push(textEncoder.encode(header), entry.bytes);
    if (entry.bytes.byteLength % 2) {
      chunks.push(textEncoder.encode("\n"));
    }
  }
  return concatBytes(chunks);
}

function tarArchive(entries: Array<{ name: string; bytes: Uint8Array }>): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const entry of entries) {
    const header = new Uint8Array(512);
    writeAscii(header, 0, 100, entry.name);
    writeAscii(header, 100, 8, "0000644");
    writeAscii(header, 108, 8, "0000000");
    writeAscii(header, 116, 8, "0000000");
    writeAscii(header, 124, 12, entry.bytes.byteLength.toString(8).padStart(11, "0"));
    writeAscii(header, 136, 12, "00000000000");
    header.fill(0x20, 148, 156);
    header[156] = "0".charCodeAt(0);
    writeAscii(header, 257, 6, "ustar");
    writeAscii(header, 263, 2, "00");
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    writeAscii(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
    chunks.push(header, entry.bytes, new Uint8Array(Math.ceil(entry.bytes.byteLength / 512) * 512 - entry.bytes.byteLength));
  }
  chunks.push(new Uint8Array(1024));
  return concatBytes(chunks);
}

function writeAscii(target: Uint8Array, offset: number, length: number, value: string): void {
  target.set(textEncoder.encode(value).slice(0, length), offset);
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function arrayBufferFromBytes(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
