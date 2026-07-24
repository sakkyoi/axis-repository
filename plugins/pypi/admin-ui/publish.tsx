import {
  PublishSessionsSection,
  publishSessionArtifactSummary,
  type PublishSession,
  type Repository,
  type RepositoryPlugin,
} from "@axis-repository/admin-ui/plugin-ui";

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
