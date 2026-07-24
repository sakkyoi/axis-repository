import {
  ValidationError,
  type ArtifactPublisher,
  type PublishedArtifactInput,
  type PublishArtifactsInput,
  type PublishArtifactRequest,
  type PublishResult,
  type RepositoryObject,
  type RepositoryObjectStore,
} from "@axis-repository/core";
import type { RepositorySigningKeyCapability } from "@axis-repository/runtime-cloudflare/plugin-runtime";
import { readDebControlMetadata, type DebControlMetadata } from "./deb-control";
import { buildAptRepositoryMetadata, parseAptRepositoryConfig } from "./metadata";

const TEXT_CONTENT_TYPE = "text/plain; charset=utf-8";
const GZIP_CONTENT_TYPE = "application/gzip";
const DEB_CONTENT_TYPE = "application/vnd.debian.binary-package";
const PGP_SIGNATURE_CONTENT_TYPE = "application/pgp-signature";

interface AptReleaseSigner {
  clearSign(input: {
    text: string;
    privateKeyArmored: string;
    passphrase: string;
    signingDate: Date;
  }): Promise<string>;
  detachSign(input: {
    text: string;
    privateKeyArmored: string;
    passphrase: string;
    signingDate: Date;
  }): Promise<string>;
}

export class AptPublisher implements ArtifactPublisher {
  constructor(
    private readonly options: {
      objectStore: RepositoryObjectStore;
      signingKeys: RepositorySigningKeyCapability;
      signer: AptReleaseSigner;
    },
  ) {}

  async publish(input: PublishArtifactsInput): Promise<PublishResult> {
    const config = parseAptRepositoryConfig(input.repository);
    if (!input.session.requestedBy.signingKeyIds.includes(config.signingKeyId)) {
      throw new ValidationError("Publish token is not scoped to the repository signing key");
    }
    const enrichedInput = await this.enrichArtifactsWithDebControlMetadata(input);
    const metadata = await buildAptRepositoryMetadata(enrichedInput);
    const key = await this.options.signingKeys.getActivePrivateKey(metadata.config.signingKeyId);
    const publishedAt = input.session.publishStartedAt ?? input.session.finalizingStartedAt ?? input.session.createdAt;
    const signingDate = new Date(publishedAt);
    const inReleasePath = metadata.releasePath.replace(/\/Release$/, "/InRelease");
    const releaseGpgPath = metadata.releasePath.replace(/\/Release$/, "/Release.gpg");
    const signingInput = {
      text: metadata.release,
      privateKeyArmored: key.privateKeyArmored,
      passphrase: key.passphrase,
      signingDate,
    };
    const inRelease = await this.options.signer.clearSign(signingInput);
    const releaseGpg = await this.options.signer.detachSign(signingInput);

    for (const copy of metadata.poolCopies) {
      await this.options.objectStore.copyObject(copy.sourceKey, copy.destinationKey, copy.contentType);
    }

    for (const packageIndex of metadata.packageIndexes) {
      await this.options.objectStore.putText(packageIndex.packagesPath, packageIndex.packages, TEXT_CONTENT_TYPE);
      await this.options.objectStore.putBytes(packageIndex.packagesGzPath, packageIndex.packagesGz, GZIP_CONTENT_TYPE);
    }

    await this.options.objectStore.putText(metadata.releasePath, metadata.release, TEXT_CONTENT_TYPE);
    await this.options.objectStore.putText(inReleasePath, inRelease, TEXT_CONTENT_TYPE);
    await this.options.objectStore.putText(releaseGpgPath, releaseGpg, PGP_SIGNATURE_CONTENT_TYPE);

    return {
      publishedAt,
      objects: [
        ...metadata.poolCopies.map((copy) => ({
          key: copy.destinationKey,
          contentType: copy.contentType || DEB_CONTENT_TYPE,
        })),
        ...metadata.packageIndexes.flatMap((packageIndex) => [
          { key: packageIndex.packagesPath, contentType: TEXT_CONTENT_TYPE },
          { key: packageIndex.packagesGzPath, contentType: GZIP_CONTENT_TYPE },
        ]),
        { key: metadata.releasePath, contentType: TEXT_CONTENT_TYPE },
        { key: inReleasePath, contentType: TEXT_CONTENT_TYPE },
        { key: releaseGpgPath, contentType: PGP_SIGNATURE_CONTENT_TYPE },
      ],
    };
  }

  private async enrichArtifactsWithDebControlMetadata(input: PublishArtifactsInput): Promise<PublishArtifactsInput> {
    return {
      ...input,
      artifacts: await Promise.all(input.artifacts.map((artifact) => this.enrichArtifact(input, artifact))),
    };
  }

  private async enrichArtifact(
    input: PublishArtifactsInput,
    artifact: PublishedArtifactInput,
  ): Promise<PublishedArtifactInput> {
    const object = await this.options.objectStore.getObject(artifact.verified.objectKey);
    if (!object) {
      throw new ValidationError("APT artifact upload object could not be read for metadata parsing");
    }

    const control = await readDebControlMetadata(await objectBytes(object));
    return {
      ...artifact,
      artifact: {
        ...artifact.artifact,
        metadata: aptArtifactMetadataFromDebControl({
          repository: input.repository,
          artifact: artifact.artifact,
          control,
        }),
      },
    };
  }
}

function aptArtifactMetadataFromDebControl(input: {
  repository: PublishArtifactsInput["repository"];
  artifact: PublishArtifactRequest;
  control: DebControlMetadata;
}): Record<string, unknown> {
  const existing = input.artifact.metadata;
  const aptConfig = input.repository.config.apt;
  const configuredComponents = aptConfig && typeof aptConfig === "object" && !Array.isArray(aptConfig)
    ? (aptConfig as Record<string, unknown>).components
    : undefined;
  const defaultComponent = Array.isArray(configuredComponents) && configuredComponents.length === 1 && typeof configuredComponents[0] === "string"
    ? configuredComponents[0]
    : undefined;

  return {
    package: metadataString(existing, "package") ?? input.control.package,
    version: metadataString(existing, "version") ?? input.control.version,
    architecture: metadataString(existing, "architecture") ?? input.control.architecture,
    component: metadataString(existing, "component") ?? defaultComponent,
    description: metadataString(existing, "description") ?? input.control.description,
    maintainer: metadataString(existing, "maintainer") ?? input.control.maintainer,
    section: metadataString(existing, "section") ?? input.control.section,
    priority: metadataString(existing, "priority") ?? input.control.priority,
    homepage: metadataString(existing, "homepage") ?? input.control.homepage,
    depends: metadataString(existing, "depends") ?? input.control.depends,
    recommends: metadataString(existing, "recommends") ?? input.control.recommends,
    suggests: metadataString(existing, "suggests") ?? input.control.suggests,
    conflicts: metadataString(existing, "conflicts") ?? input.control.conflicts,
    replaces: metadataString(existing, "replaces") ?? input.control.replaces,
    provides: metadataString(existing, "provides") ?? input.control.provides,
  };
}

function metadataString(metadata: Record<string, unknown>, field: string): string | undefined {
  const value = metadata[field];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

async function objectBytes(object: RepositoryObject): Promise<Uint8Array> {
  if (object.body instanceof Uint8Array) {
    return object.body;
  }
  if (typeof object.body === "string") {
    return new TextEncoder().encode(object.body);
  }
  const chunks: Uint8Array[] = [];
  const reader = object.body.getReader();
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    chunks.push(next.value);
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
