import {
  ValidationError,
  type ArtifactPublisher,
  type Repository,
  type RepositoryArtifactRecord,
} from "@axis-repository/core";
import { aptPluginManifest } from "../manifest";
import type {
  ArtifactRepositoryPlugin,
  DescribePublishedArtifactsInput,
  ProvisionRepositoryCreateInput,
  RebuildRepositoryArtifactIndexInput,
  RepositoryMaintenanceInput,
  RepositorySigningKeyCapability,
  ValidateRepositoryCreateProvisioningInput,
  ValidateRepositoryConfigInput,
} from "@axis-repository/runtime-cloudflare/plugin-runtime";
import { createPrefixServingPredicate } from "@axis-repository/runtime-cloudflare/plugin-runtime";
import { createAptAdminResources } from "./admin-resources";
import { createAptClientHelpers } from "./client-helpers";
import type { AptReleaseSigner } from "./index-store";
import { parseAptRepositoryConfig, validateAptPublishArtifacts } from "./metadata";
import { renewAptReleaseSignatures } from "./maintenance";
import { reconcileAptRepository } from "./rebuild";

export { AptSigningKeyResource } from "./signing-keys";

function repositoryForConfig(input: ValidateRepositoryConfigInput): Repository {
  return {
    id: "repo_validation",
    name: "repo-validation",
    ecosystem: input.ecosystem,
    visibility: "private",
    config: input.config,
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
  };
}

export function createAptPlugin(input: {
  publisher: ArtifactPublisher;
  signingKeys: RepositorySigningKeyCapability;
  signer: AptReleaseSigner;
}): ArtifactRepositoryPlugin {
  return {
    ecosystem: "apt",
    name: aptPluginManifest.runtimeName,
    version: aptPluginManifest.version,
    capabilities: [...aptPluginManifest.capabilities],
    canServeRepositoryPath: createPrefixServingPredicate(["dists", "pool"]),
    validateRepositoryConfig: (configInput) => {
      parseAptRepositoryConfig(repositoryForConfig(configInput));
    },
    create: {
      validateProvisioning: validateAptCreateProvisioning,
      provision: (provisionInput) => provisionAptRepository(input.signingKeys, provisionInput),
    },
    publish: {
      validateArtifacts: validateAptPublishArtifacts,
      derivePrincipalScope: (repository) => {
        const config = parseAptRepositoryConfig(repository);
        return {
          signingKeyIds: [config.signingKeyId],
        };
      },
      authorize: ({ repository, principal }) => {
        const config = parseAptRepositoryConfig(repository);
        if (!principal.signingKeyIds.includes(config.signingKeyId)) {
          throw new ValidationError("Publish token is not scoped to the repository signing key");
        }
      },
      finalize: (publishInput) => input.publisher.publish(publishInput),
      describeArtifacts: describeAptArtifacts,
    },
    artifacts: {
      rebuildIndex: (rebuildInput: RebuildRepositoryArtifactIndexInput) =>
        reconcileAptRepository({
          ...rebuildInput,
          signingKeys: input.signingKeys,
          signer: input.signer,
        }),
    },
    maintenance: {
      run: (maintenanceInput: RepositoryMaintenanceInput) =>
        renewAptReleaseSignatures({
          ...maintenanceInput,
          signingKeys: input.signingKeys,
          signer: input.signer,
        }),
    },
    clientHelpers: createAptClientHelpers({ signingKeys: input.signingKeys }),
    adminResources: createAptAdminResources({ signingKeys: input.signingKeys }),
  };
}

function validateAptCreateProvisioning(input: ValidateRepositoryCreateProvisioningInput): void {
  parseAptSigningKeyProvisioning(input.provisioning);
}

async function provisionAptRepository(
  signingKeys: RepositorySigningKeyCapability,
  input: ProvisionRepositoryCreateInput,
): Promise<{ configPatch: Record<string, unknown> }> {
  const signingKey = parseAptSigningKeyProvisioning(input.provisioning);
  if (signingKey.mode === "existing") {
    const key = await signingKeys.getPublicKey(signingKey.signingKeyId);
    if (key.repositoryName !== input.repositoryName) {
      throw new ValidationError("Signing key is not scoped to this repository");
    }
    if (key.revokedAt) {
      throw new ValidationError("Signing key has been revoked");
    }
    return aptSigningKeyConfigPatch(key.id);
  }
  if (signingKey.mode === "import") {
    const key = await signingKeys.create({
      repositoryName: input.repositoryName,
      name: signingKey.name,
      privateKeyArmored: signingKey.privateKeyArmored,
      passphrase: signingKey.passphrase,
    });
    return aptSigningKeyConfigPatch(key.id);
  }
  const key = await signingKeys.generate({
    repositoryName: input.repositoryName,
    name: signingKey.name,
    userIdName: signingKey.userIdName,
    userIdEmail: signingKey.userIdEmail,
  });
  return aptSigningKeyConfigPatch(key.id);
}

function aptSigningKeyConfigPatch(signingKeyId: string): { configPatch: Record<string, unknown> } {
  return {
    configPatch: {
      apt: {
        signingKeyId,
      },
    },
  };
}

type AptSigningKeyProvisioning =
  | { mode: "generate"; name: string; userIdName: string; userIdEmail: string }
  | { mode: "import"; name: string; privateKeyArmored: string; passphrase: string }
  | { mode: "existing"; signingKeyId: string };

function parseAptSigningKeyProvisioning(provisioning: Record<string, unknown>): AptSigningKeyProvisioning {
  const apt = readRecord(provisioning.apt);
  const signingKey = readRecord(apt.signingKey);
  const mode = requiredProvisioningString(signingKey, "mode");
  if (mode === "existing") {
    return {
      mode,
      signingKeyId: requiredProvisioningString(signingKey, "signingKeyId"),
    };
  }
  if (mode === "import") {
    return {
      mode,
      name: requiredProvisioningString(signingKey, "name"),
      privateKeyArmored: requiredProvisioningString(signingKey, "privateKeyArmored"),
      passphrase: requiredProvisioningString(signingKey, "passphrase"),
    };
  }
  if (mode === "generate") {
    return {
      mode,
      name: requiredProvisioningString(signingKey, "name"),
      userIdName: requiredProvisioningString(signingKey, "userIdName"),
      userIdEmail: requiredProvisioningString(signingKey, "userIdEmail"),
    };
  }
  throw new ValidationError("Signing key provisioning mode is invalid");
}

function readRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function requiredProvisioningString(config: Record<string, unknown>, field: string): string {
  const value = config[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new ValidationError(`Signing key ${field} is required`);
  }
  return value;
}

function describeAptArtifacts(input: DescribePublishedArtifactsInput): RepositoryArtifactRecord[] {
  return input.session.artifacts.map((artifact) => {
    const packageName = metadataString(artifact.metadata, "package") ?? artifact.filename;
    const version = metadataString(artifact.metadata, "version");
    const architecture = metadataString(artifact.metadata, "architecture");
    const component = metadataString(artifact.metadata, "component") ?? "main";
    const primaryObjectKey = input.result.objects.find((object) =>
      object.key.includes("/pool/") && object.key.endsWith(`/${artifact.filename}`),
    )?.key;
    const identityParts = ["apt", component, packageName, version, architecture].filter((part): part is string =>
      Boolean(part),
    );
    const summaryParts = [packageName, version, architecture].filter((part): part is string => Boolean(part));
    return {
      id: `artifact_${input.repository.name}_${identityParts.join("_")}`,
      repositoryName: input.repository.name,
      ecosystem: input.repository.ecosystem,
      identity: identityParts.join(":"),
      name: packageName,
      ...(version ? { version } : {}),
      summary: summaryParts.join(" "),
      ...(primaryObjectKey ? { primaryObjectKey } : {}),
      objectKeys: primaryObjectKey ? [primaryObjectKey] : [],
      metadata: { ...artifact.metadata },
      publishedAt: input.result.publishedAt,
      updatedAt: input.result.publishedAt,
      publishSessionId: input.session.id,
    };
  });
}

function metadataString(metadata: Record<string, unknown>, field: string): string | undefined {
  const value = metadata[field];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

