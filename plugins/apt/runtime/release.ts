import type { AptResolvedRepositoryConfig } from "./config";
import { digestHex } from "./digest";
import type { AptPackageIndex } from "./packages";

const textEncoder = new TextEncoder();

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

  return [
    `Origin: ${input.repositoryName}`,
    `Label: ${input.repositoryName}`,
    `Suite: ${input.config.codename}`,
    `Codename: ${input.config.codename}`,
    `Date: ${new Date(input.publishDate).toUTCString()}`,
    `Architectures: ${input.config.architectures.join(" ")}`,
    `Components: ${input.config.components.join(" ")}`,
    "Acquire-By-Hash: no",
    "SHA256:",
    ...sha256Lines,
    "SHA512:",
    ...sha512Lines,
    "",
  ].join("\n");
}
