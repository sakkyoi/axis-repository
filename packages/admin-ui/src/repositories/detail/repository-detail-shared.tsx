import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import {
  useRepositoryActivities,
  useRepositoryClientHelper,
  useUpdateRepository,
} from "../../api/hooks";
import type { PublishSession, Repository, RepositoryClientHelperAction, RepositoryPlugin, RepositoryVisibility } from "../../api/schemas";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";
import { asJson, ErrorState } from "../../pages/shared";
import {
  publishSessionArtifactSummary,
  repositoryActivityActionLabel,
  repositoryActivityStatusMeta,
  repositoryActivitySummary,
  type RepositoryActivity,
} from "../publish/repository-publish-sessions-model";
import type { PublishSessionDetailComponentProps, RepositoryDetailSection } from "../plugins/repository-ui-plugin-types";

export function GenericRepositoryDetail({ repository }: { repository: Repository; pluginMetadata: RepositoryPlugin | undefined }) {
  return (
    <>
      <RepositorySettingsSection repository={repository} pluginMetadata={undefined} />
      <AdvancedJsonConfigSection repository={repository} pluginMetadata={undefined} />
    </>
  );
}

export function RepositoryDetailSections({
  repository,
  pluginMetadata,
  sections,
  onPublishFiles,
}: {
  repository: Repository;
  pluginMetadata: RepositoryPlugin | undefined;
  sections: RepositoryDetailSection[];
  onPublishFiles?: (files: File[]) => void;
}) {
  return (
    <>
      {sections.map((section) => (
        <section key={section.id} className="grid gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
          <h3 className="text-sm font-semibold">{section.title}</h3>
          <section.Component
            repository={repository}
            pluginMetadata={pluginMetadata}
            {...(onPublishFiles ? { onPublishFiles } : {})}
          />
        </section>
      ))}
    </>
  );
}

export function RepositorySettingsSection({
  repository,
}: {
  repository: Repository;
  pluginMetadata: RepositoryPlugin | undefined;
}) {
  const [visibility, setVisibility] = useState<RepositoryVisibility>(repository.visibility);
  const updateRepository = useUpdateRepository();

  useEffect(() => {
    setVisibility(repository.visibility);
  }, [repository]);

  return (
    <div className="grid gap-3">
      <label className="grid gap-2">
        <span className="text-sm font-medium">Visibility</span>
        <VisibilitySelect value={visibility} onChange={setVisibility} />
      </label>
      <Button
        onClick={() => updateRepository.mutate({ name: repository.name, input: { visibility, config: repository.config } })}
        disabled={updateRepository.isPending}
      >
        <Save className="mr-2 h-4 w-4" />
        Save repository
      </Button>
      {updateRepository.isError && <ErrorState error={updateRepository.error} />}
    </div>
  );
}

export function PublishSessionsSection({
  repository,
  artifactSummary = publishSessionArtifactSummary,
  SessionDetailComponent = GenericPublishSessionDetail,
  hideTitle = false,
}: {
  repository: Repository;
  pluginMetadata: RepositoryPlugin | undefined;
  artifactSummary?: (session: PublishSession) => string;
  SessionDetailComponent?: React.ComponentType<PublishSessionDetailComponentProps>;
  hideTitle?: boolean;
}) {
  const repositoryActivities = useRepositoryActivities(repository.name);
  const activities = repositoryActivities.data?.pages.flatMap((page) => page.activities) ?? [];

  return (
    <section className="grid gap-2">
      <div className="flex items-center justify-between gap-3">
        {!hideTitle && <h3 className="text-sm font-semibold">Activity</h3>}
        {activities.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {activities.length} loaded
          </span>
        )}
      </div>
      {repositoryActivities.isLoading && <p className="text-sm text-muted-foreground">Loading activity...</p>}
      {repositoryActivities.isError && <ErrorState title="Activity unavailable" error={repositoryActivities.error} />}
      {!repositoryActivities.isLoading && !repositoryActivities.isError && activities.length === 0 && (
        <div className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
          No repository activity yet.
        </div>
      )}
      {!repositoryActivities.isLoading &&
        !repositoryActivities.isError &&
        activities.map((activity) => (
          <RepositoryActivityItem
            key={activity.id}
            activity={activity}
            artifactSummary={artifactSummary}
            SessionDetailComponent={SessionDetailComponent}
          />
        ))}
      {!repositoryActivities.isLoading && !repositoryActivities.isError && repositoryActivities.hasNextPage && (
        <Button
          type="button"
          variant="outline"
          disabled={repositoryActivities.isFetchingNextPage}
          onClick={() => void repositoryActivities.fetchNextPage()}
        >
          {repositoryActivities.isFetchingNextPage ? "Loading..." : "Load more"}
        </Button>
      )}
    </section>
  );
}

function RepositoryActivityItem({
  activity,
  artifactSummary,
  SessionDetailComponent,
}: {
  activity: RepositoryActivity;
  artifactSummary: (session: PublishSession) => string;
  SessionDetailComponent: React.ComponentType<PublishSessionDetailComponentProps>;
}) {
  const status = repositoryActivityStatusMeta(activity);
  return (
    <details className="group min-w-0 rounded-md border border-border bg-background/40 px-3 py-2">
      <summary className="cursor-pointer list-none">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-medium">{repositoryActivityActionLabel(activity)}</span>
              <Badge variant={status.variant}>{status.label}</Badge>
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {repositoryActivitySummary(activity, artifactSummary)}
            </p>
          </div>
          <div className="shrink-0 text-right text-xs text-muted-foreground">
            <div>{activity.createdAt}</div>
            <div className="mt-1 text-[11px] group-open:hidden">Details</div>
          </div>
        </div>
      </summary>
      {activity.type === "publish" ? (
        <SessionDetailComponent session={activity.session} artifactSummary={artifactSummary} />
      ) : (
        <RepositoryObjectActivityDetail activity={activity} />
      )}
    </details>
  );
}

function RepositoryObjectActivityDetail({ activity }: { activity: Extract<RepositoryActivity, { type: "object.delete" | "object.update" }> }) {
  const metadataItems = [
    activity.type === "object.update" && typeof activity.metadata.previousContentType === "string"
      ? `previous content type: ${activity.metadata.previousContentType}`
      : undefined,
    activity.type === "object.update" && typeof activity.metadata.previousSize === "number"
      ? `previous size: ${activity.metadata.previousSize} bytes`
      : undefined,
    activity.type === "object.update" && typeof activity.metadata.contentType === "string"
      ? `current content type: ${activity.metadata.contentType}`
      : undefined,
  ].filter((item): item is string => Boolean(item));
  return (
    <div className="mt-3 grid gap-2 text-xs">
      <PublishSessionDetailList title={activity.type === "object.update" ? "Updated object" : "Deleted object"} items={[String(activity.metadata.path ?? activity.summary)]} />
      <PublishSessionDetailList title="Object key" items={[String(activity.metadata.objectKey ?? "")]} />
      {metadataItems.length > 0 && <PublishSessionDetailList title="Metadata change" items={metadataItems} />}
    </div>
  );
}

export function GenericPublishSessionDetail({
  session,
}: PublishSessionDetailComponentProps) {
  return (
    <div className="mt-3 grid gap-3 text-xs">
      <PublishSessionDetailList title="Artifacts" items={session.artifacts.map((artifact) => artifact.filename)} />
      <PublishSessionDetailList title="Uploads" items={session.uploads.map((upload) => `${upload.uploadId} · ${upload.filename}`)} />
      <PublishSessionDetailList
        title="Verified uploads"
        items={session.verifiedUploads.map((upload) => `${upload.uploadId} · ${upload.size} bytes`)}
      />
      {session.publishResult && (
        <PublishSessionDetailList
          title="Published objects"
          items={session.publishResult.objects.map((object) => object.key)}
        />
      )}
      {session.failure && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-destructive">
          {session.failure.message}
        </div>
      )}
    </div>
  );
}

export function PublishSessionDetailList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="grid gap-1">
      <div className="font-medium text-muted-foreground">{title}</div>
      {items.length === 0 ? (
        <div className="text-muted-foreground">None</div>
      ) : (
        <ul className="grid gap-1">
          {items.map((item) => (
            <li key={item} className="break-all rounded bg-muted px-2 py-1">
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AdvancedJsonConfigSection({
  repository,
}: {
  repository: Repository;
  pluginMetadata: RepositoryPlugin | undefined;
}) {
  return <RepositoryJsonConfigEditor repository={repository} />;
}

export function RepositoryJsonConfigEditor({ repository }: { repository: Repository }) {
  const [config, setConfig] = useState(asJson(repository.config));
  const [configError, setConfigError] = useState("");
  const updateRepository = useUpdateRepository();

  useEffect(() => {
    setConfig(asJson(repository.config));
    setConfigError("");
  }, [repository]);

  async function saveJsonConfig() {
    let parsedConfig: Record<string, unknown>;
    try {
      parsedConfig = JSON.parse(config) as Record<string, unknown>;
      setConfigError("");
    } catch (error) {
      setConfigError(error instanceof Error ? error.message : "Invalid JSON");
      return;
    }

    updateRepository.mutate({
      name: repository.name,
      input: {
        visibility: repository.visibility,
        config: parsedConfig,
      },
    });
  }

  return (
    <>
      <label className="grid gap-2">
        <span className="text-sm font-medium">Config JSON</span>
        <Textarea value={config} onChange={(event) => setConfig(event.target.value)} />
      </label>
      {configError && <ErrorState error={configError} />}
      <Button onClick={saveJsonConfig} disabled={updateRepository.isPending}>
        <Save className="mr-2 h-4 w-4" />
        Save repository
      </Button>
      {updateRepository.isError && <ErrorState error={updateRepository.error} />}
    </>
  );
}

export function VisibilitySelect({ value, onChange }: { value: RepositoryVisibility; onChange: (value: RepositoryVisibility) => void }) {
  return (
    <Select value={value} onValueChange={(nextValue) => onChange(nextValue as RepositoryVisibility)}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="private">private</SelectItem>
        <SelectItem value="public">public</SelectItem>
      </SelectContent>
    </Select>
  );
}

function shellScriptFromHelperResponse(data: unknown): string | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data) || !("script" in data)) return undefined;
  const script = (data as { script?: unknown }).script;
  return typeof script === "string" ? script : undefined;
}

export function repositoryClientHelperDisplayText(
  action: Pick<RepositoryClientHelperAction, "responseKind" | "displayPath">,
  data: unknown,
): string {
  const displayData = action.displayPath && data && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>)[action.displayPath]
    : data;
  if (action.responseKind === "shell") {
    return shellScriptFromHelperResponse(displayData) ?? (typeof displayData === "string" ? displayData : asJson(displayData));
  }
  if (action.responseKind === "json") {
    return asJson(displayData);
  }
  return typeof displayData === "string" ? displayData : asJson(displayData);
}

export function RepositoryClientHelperSetup({
  repositoryName,
  clientHelpers,
}: {
  repositoryName: string;
  clientHelpers: RepositoryPlugin["clientHelpers"];
}) {
  if (!clientHelpers || clientHelpers.actions.length === 0) return null;
  return (
    <div className="grid gap-3">
      {clientHelpers.actions.map((action) => (
        <RepositoryClientHelperItem
          key={action.name}
          repositoryName={repositoryName}
          namespace={clientHelpers.namespace}
          action={action}
        />
      ))}
    </div>
  );
}

export function RepositoryClientHelpersSection({
  repository,
  pluginMetadata,
}: {
  repository: Repository;
  pluginMetadata: RepositoryPlugin | undefined;
}) {
  return (
    <RepositoryClientHelperSetup
      repositoryName={repository.name}
      clientHelpers={pluginMetadata?.clientHelpers}
    />
  );
}

export function RepositoryClientHelperItem({
  repositoryName,
  namespace,
  action,
}: {
  repositoryName: string;
  namespace: string;
  action: RepositoryClientHelperAction;
}) {
  const helper = useRepositoryClientHelper(repositoryName, namespace, action.name, true);
  return (
    <details className="min-w-0" open={action.defaultOpen}>
      <summary className="cursor-pointer text-sm font-medium">{action.label}</summary>
      <pre className="mt-2 max-h-64 max-w-full overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs">
        {helper.data !== undefined ? repositoryClientHelperDisplayText(action, helper.data) : "Loading..."}
      </pre>
      {helper.isError && <ErrorState title={`${action.label} unavailable`} error={helper.error} />}
    </details>
  );
}
