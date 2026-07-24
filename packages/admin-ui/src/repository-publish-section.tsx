import { PublishSessionsSection } from "./repository-detail-shared";
import { getRepositoryPublishPlugin } from "./repository-ui-plugins";
import type { RepositoryDetailSectionProps } from "./repository-ui-plugin-types";

export function RepositoryPublishSection({
  repository,
  pluginMetadata,
}: RepositoryDetailSectionProps) {
  const publishPlugin = getRepositoryPublishPlugin(repository.ecosystem);
  const FormComponent = publishPlugin?.FormComponent;
  return (
    <div className="grid gap-2">
      {FormComponent && <FormComponent repository={repository} pluginMetadata={pluginMetadata} />}
      <PublishSessionsSection
        repository={repository}
        pluginMetadata={pluginMetadata}
        {...(publishPlugin?.artifactSummary ? { artifactSummary: publishPlugin.artifactSummary } : {})}
        {...(publishPlugin?.SessionDetailComponent ? { SessionDetailComponent: publishPlugin.SessionDetailComponent } : {})}
      />
    </div>
  );
}
