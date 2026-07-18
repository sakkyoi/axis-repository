import {
  ValidationError,
  type ArtifactPublisher,
  type PublishArtifactsInput,
  type PublishResult,
  type RepositoryObjectStore,
} from "@axis-repository/core";
import { buildAptRepositoryMetadata } from "./apt-metadata";
import type { SigningKeyService } from "./signing-key-service";

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
      signingKeyService: SigningKeyService;
      signer: AptReleaseSigner;
    },
  ) {}

  async publish(input: PublishArtifactsInput): Promise<PublishResult> {
    const metadata = await buildAptRepositoryMetadata(input);
    if (!input.session.requestedBy.signingKeyIds.includes(metadata.config.signingKeyId)) {
      throw new ValidationError("Publish token is not scoped to the repository signing key");
    }
    const key = await this.options.signingKeyService.getActivePrivateKey(metadata.config.signingKeyId);
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
}
