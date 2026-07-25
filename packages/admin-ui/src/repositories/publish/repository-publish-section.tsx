import { PublishSessionsSection } from "../detail/repository-detail-shared";
import { getRepositoryPublishPlugin } from "../plugins/repository-ui-plugins";
import type { RepositoryDetailSectionProps } from "../plugins/repository-ui-plugin-types";

export function RepositoryPublishSection({
  repository,
  pluginMetadata,
}: RepositoryDetailSectionProps) {
  const publishPlugin = getRepositoryPublishPlugin(repository.ecosystem);
  const PreviewComponent = publishPlugin?.PreviewComponent;
  return (
    <div className="grid gap-2">
      {PreviewComponent && (
        <PreviewComponent
          repository={repository}
          pluginMetadata={pluginMetadata}
          droppedFiles={[]}
          onCancel={() => undefined}
          onPublished={() => undefined}
        />
      )}
      <PublishSessionsSection
        repository={repository}
        pluginMetadata={pluginMetadata}
        {...(publishPlugin?.artifactSummary ? { artifactSummary: publishPlugin.artifactSummary } : {})}
        {...(publishPlugin?.SessionDetailComponent ? { SessionDetailComponent: publishPlugin.SessionDetailComponent } : {})}
      />
    </div>
  );
}
