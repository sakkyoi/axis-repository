import type { PublishSession, Repository, RepositoryPlugin } from "../../../packages/admin-ui/src/api/schemas";
import { PublishSessionsSection } from "../../../packages/admin-ui/src/repository-detail-shared";
import { publishSessionArtifactSummary } from "../../../packages/admin-ui/src/repository-publish-sessions-model";

export function PypiPublishSessionsSection({
  repository,
  pluginMetadata,
}: {
  repository: Repository;
  pluginMetadata: RepositoryPlugin | undefined;
}) {
  return (
    <PublishSessionsSection
      repository={repository}
      pluginMetadata={pluginMetadata}
      artifactSummary={pypiPublishSessionArtifactSummary}
    />
  );
}

export function pypiPublishSessionArtifactSummary(session: PublishSession): string {
  const artifact = session.artifacts[0];
  if (!artifact || session.artifacts.length !== 1) return publishSessionArtifactSummary(session);
  return `${artifact.filename}, ${session.verifiedUploads.length} verified`;
}
