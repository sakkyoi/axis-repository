import {
  ValidationError,
  type ArtifactPublisher,
  type PublishedObject,
  type PublishedArtifactInput,
  type PublishArtifactsInput,
  type PublishArtifactRequest,
  type PublishResult,
  type RepositoryObject,
  type RepositoryObjectMetadata,
  type RepositoryObjectStore,
} from "@axis-repository/core";
import { objectBytes, type RepositorySigningKeyCapability } from "@axis-repository/runtime-cloudflare/plugin-runtime";
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
    const key = await this.options.signingKeys.getActivePrivateKey(
      metadata.config.signingKeyId,
      input.repository.name,
    );
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
    const publishedObjects: PublishedObject[] = [
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
    ];
    const previousByKey = new Map(
      await Promise.all(publishedObjects.map(async (object) => [object.key, await this.options.objectStore.headObject(object.key)] as const)),
    );

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
      objects: publishedObjects.map((object) => ({
        ...object,
        ...publishedObjectPrevious(previousByKey.get(object.key) ?? null),
      })),
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

function publishedObjectPrevious(previous: RepositoryObjectMetadata | null): Pick<PublishedObject, "previous"> | Record<string, never> {
  if (!previous) {
    return {};
  }
  return {
    previous: {
      ...(previous.contentType !== undefined ? { contentType: previous.contentType } : {}),
      ...(previous.contentLength !== undefined ? { size: previous.contentLength } : {}),
      ...(previous.etag !== undefined ? { etag: previous.etag } : {}),
    },
  };
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
    package: input.control.package,
    version: input.control.version,
    architecture: input.control.architecture,
    component: metadataString(existing, "component") ?? defaultComponent,
    description: input.control.description,
    maintainer: input.control.maintainer,
    section: input.control.section,
    priority: input.control.priority,
    homepage: input.control.homepage,
    depends: input.control.depends,
    recommends: input.control.recommends,
    suggests: input.control.suggests,
    conflicts: input.control.conflicts,
    replaces: input.control.replaces,
    provides: input.control.provides,
  };
}

function metadataString(metadata: Record<string, unknown>, field: string): string | undefined {
  const value = metadata[field];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

