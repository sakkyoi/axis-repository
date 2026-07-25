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
  RepositorySigningKeyCapability,
  ValidateRepositoryConfigInput,
} from "@axis-repository/runtime-cloudflare/plugin-runtime";
import { createPrefixServingPredicate } from "@axis-repository/runtime-cloudflare/plugin-runtime";
import { createAptAdminResources } from "./admin-resources";
import { createAptClientHelpers } from "./client-helpers";
import { parseAptRepositoryConfig, validateAptPublishArtifacts } from "./metadata";

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
    clientHelpers: createAptClientHelpers({ signingKeys: input.signingKeys }),
    adminResources: createAptAdminResources({ signingKeys: input.signingKeys }),
  };
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
