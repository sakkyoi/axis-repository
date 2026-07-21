import { ValidationError, type ArtifactPublisher, type Repository } from "@axis-repository/core";
import type { ArtifactRepositoryPlugin, ValidateRepositoryConfigInput } from "./artifact-publisher-registry";
import { createPrefixServingPredicate } from "./artifact-publisher-registry";
import { parseAptRepositoryConfig, validateAptPublishArtifacts } from "./apt-metadata";

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

export function createAptPlugin(input: { publisher: ArtifactPublisher }): ArtifactRepositoryPlugin {
  return {
    ecosystem: "apt",
    name: "apt-signed",
    version: "0.1.0",
    capabilities: ["apt", "signed-release", "pool-copy", "serve:dists", "serve:pool"],
    publisher: input.publisher,
    canServeRepositoryPath: createPrefixServingPredicate(["dists", "pool"]),
    validateRepositoryConfig: (configInput) => {
      parseAptRepositoryConfig(repositoryForConfig(configInput));
    },
    validatePublishArtifacts: validateAptPublishArtifacts,
    authorizePublish: ({ repository, principal }) => {
      const config = parseAptRepositoryConfig(repository);
      if (!principal.signingKeyIds.includes(config.signingKeyId)) {
        throw new ValidationError("Publish token is not scoped to the repository signing key");
      }
    },
  };
}
