import { md5Hex } from "../shared/md5";
import type { AptResolvedRepositoryConfig } from "./config";
import { digestHex } from "./digest";
import type { AptIndexFile } from "./index-files";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Checksum sections written into `Release`, in the order Debian writes them.
 *
 * `MD5Sum` is here for tools that predate SHA256; integrity rests on the
 * stronger digests and on the OpenPGP signature over this file.
 */
export const RELEASE_CHECKSUM_SECTIONS = ["MD5Sum", "SHA256", "SHA512"] as const;

export type ReleaseChecksumSection = typeof RELEASE_CHECKSUM_SECTIONS[number];

/**
 * Digests that also get a `by-hash` directory.
 *
 * `MD5Sum` is deliberately left out: by-hash arrived long after SHA256, so no
 * client that understands it would ask for an index by its MD5, and each extra
 * digest is another full copy of every index to store.
 */
export const BY_HASH_SECTIONS = ["SHA256", "SHA512"] as const satisfies readonly ReleaseChecksumSection[];

/** by-hash is on unless the repository turns it off. */
export function acquireByHashEnabled(config: AptResolvedRepositoryConfig): boolean {
  return config.acquireByHash ?? true;
}

export async function checksumForSection(section: ReleaseChecksumSection, bytes: Uint8Array): Promise<string> {
  if (section === "MD5Sum") {
    return md5Hex(bytes);
  }
  return digestHex(section === "SHA256" ? "SHA-256" : "SHA-512", bytes);
}

export async function buildRelease(input: {
  repositoryName: string;
  config: AptResolvedRepositoryConfig;
  publishDate: string;
  indexFiles: AptIndexFile[];
}): Promise<string> {
  const checksumSections: string[] = [];

  for (const section of RELEASE_CHECKSUM_SECTIONS) {
    checksumSections.push(`${section}:`);
    for (const file of input.indexFiles) {
      const checksum = await checksumForSection(section, file.bytes);
      checksumSections.push(` ${checksum} ${file.bytes.byteLength} ${file.relativePath}`);
    }
  }

  const publishedAt = new Date(input.publishDate);

  return [
    `Origin: ${input.config.origin ?? input.repositoryName}`,
    `Label: ${input.config.label ?? input.repositoryName}`,
    `Suite: ${input.config.suite ?? input.config.codename}`,
    `Codename: ${input.config.codename}`,
    `Date: ${publishedAt.toUTCString()}`,
    // Without this apt trusts a signed Release forever, so an attacker who can
    // serve stale bytes can hold a client on a known-vulnerable package set.
    ...(input.config.validityDays === undefined
      ? []
      : [`Valid-Until: ${new Date(publishedAt.getTime() + input.config.validityDays * MILLISECONDS_PER_DAY).toUTCString()}`]),
    `Architectures: ${input.config.architectures.join(" ")}`,
    `Components: ${input.config.components.join(" ")}`,
    ...(input.config.notAutomatic ? ["NotAutomatic: yes"] : []),
    ...(input.config.butAutomaticUpgrades ? ["ButAutomaticUpgrades: yes"] : []),
    ...(input.config.description === undefined ? [] : [`Description: ${input.config.description}`]),
    `Acquire-By-Hash: ${acquireByHashEnabled(input.config) ? "yes" : "no"}`,
    ...checksumSections,
    "",
  ].join("\n");
}
