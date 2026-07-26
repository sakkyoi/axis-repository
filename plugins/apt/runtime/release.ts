import type { AptResolvedRepositoryConfig } from "./config";
import { digestHex } from "./digest";
import type { AptPackageIndex } from "./packages";

const textEncoder = new TextEncoder();
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** by-hash is on unless the repository turns it off. */
export function acquireByHashEnabled(config: AptResolvedRepositoryConfig): boolean {
  return config.acquireByHash ?? true;
}

export async function buildRelease(input: {
  repositoryName: string;
  config: AptResolvedRepositoryConfig;
  publishDate: string;
  packageIndexes: AptPackageIndex[];
}): Promise<string> {
  const sha256Lines: string[] = [];
  const sha512Lines: string[] = [];

  for (const packageIndex of input.packageIndexes) {
    const packagesBytes = textEncoder.encode(packageIndex.packages);
    const packagesSha256 = await digestHex("SHA-256", packagesBytes);
    const packagesGzSha256 = await digestHex("SHA-256", packageIndex.packagesGz);
    const packagesSha512 = await digestHex("SHA-512", packagesBytes);
    const packagesGzSha512 = await digestHex("SHA-512", packageIndex.packagesGz);

    sha256Lines.push(
      ` ${packagesSha256} ${packagesBytes.byteLength} ${packageIndex.relativePath}`,
      ` ${packagesGzSha256} ${packageIndex.packagesGz.byteLength} ${packageIndex.relativeGzPath}`,
    );
    sha512Lines.push(
      ` ${packagesSha512} ${packagesBytes.byteLength} ${packageIndex.relativePath}`,
      ` ${packagesGzSha512} ${packageIndex.packagesGz.byteLength} ${packageIndex.relativeGzPath}`,
    );
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
    "SHA256:",
    ...sha256Lines,
    "SHA512:",
    ...sha512Lines,
    "",
  ].join("\n");
}
