import { ValidationError, type ArtifactPublisher, type Repository } from "@axis-repository/core";
import { aptPluginManifest } from "../manifest";
import type {
  ArtifactRepositoryPlugin,
  RepositorySigningKeyCapability,
  ValidateRepositoryConfigInput,
} from "@axis-repository/runtime-cloudflare/plugin-runtime";
import { createPrefixServingPredicate } from "@axis-repository/runtime-cloudflare/plugin-runtime";
import { createAptAdminResources } from "./admin-resources";
import { createAptClientHelpers } from "./client-helpers";
import { parseAptRepositoryConfig, validateAptPublishArtifacts } from "./metadata";

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
    },
    clientHelpers: createAptClientHelpers({ signingKeys: input.signingKeys }),
    adminResources: createAptAdminResources({ signingKeys: input.signingKeys }),
  };
}
