import { useState } from "react";
import { PackagePlus } from "lucide-react";
import {
  Button,
  ErrorState,
  Input,
  PublishSessionsSection,
  useRepositoryArtifactPublisher,
  type Repository,
  type RepositoryPlugin,
} from "@axis-repository/admin-ui/plugin-ui";
import {
  aptPublishSessionArtifactSummary,
  buildAptPublishArtifact,
  defaultAptPublishFormValues,
  type AptPublishFormValues,
} from "./publish-model";

export function AptPublishSessionsSection({
  repository,
  pluginMetadata,
}: {
  repository: Repository;
  pluginMetadata: RepositoryPlugin | undefined;
}) {
  return (
    <div className="grid gap-2">
      <AptPublishArtifactForm repository={repository} />
      <PublishSessionsSection
        repository={repository}
        pluginMetadata={pluginMetadata}
        artifactSummary={aptPublishSessionArtifactSummary}
      />
    </div>
  );
}

function AptPublishArtifactForm({ repository }: { repository: Repository }) {
  const publisher = useRepositoryArtifactPublisher(repository);
  const [file, setFile] = useState<File>();
  const [values, setValues] = useState<AptPublishFormValues>(() => defaultAptPublishFormValues());
  const [error, setError] = useState("");

  function updateValue(key: keyof AptPublishFormValues, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function onFileSelected(nextFile: File | undefined) {
    setFile(nextFile);
    if (nextFile) {
      setValues((current) => ({
        ...current,
        ...defaultAptPublishFormValues(nextFile.name),
      }));
    }
  }

  async function publishArtifact() {
    if (!file) {
      setError("Choose a .deb file before publishing.");
      return;
    }
    setError("");
    try {
      const artifact = await buildAptPublishArtifact(file, values);
      await publisher.publish({ files: [file], artifacts: [artifact] });
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : String(publishError));
    }
  }

  return (
    <div className="grid gap-3 rounded-md border border-border bg-background/40 p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <PackagePlus className="h-4 w-4" />
        Publish APT artifact
      </div>
      <Input
        type="file"
        accept=".deb,application/vnd.debian.binary-package"
        onChange={(event) => onFileSelected(event.currentTarget.files?.[0])}
      />
      <div className="grid gap-2 sm:grid-cols-2">
        <PublishTextInput label="Package" value={values.packageName} onChange={(value) => updateValue("packageName", value)} />
        <PublishTextInput label="Version" value={values.version} onChange={(value) => updateValue("version", value)} />
        <PublishTextInput label="Architecture" value={values.architecture} onChange={(value) => updateValue("architecture", value)} />
        <PublishTextInput label="Component" value={values.component} onChange={(value) => updateValue("component", value)} />
        <PublishTextInput label="Section" value={values.section} onChange={(value) => updateValue("section", value)} />
        <PublishTextInput label="Priority" value={values.priority} onChange={(value) => updateValue("priority", value)} />
      </div>
      <PublishTextInput label="Description" value={values.description} onChange={(value) => updateValue("description", value)} />
      <PublishTextInput label="Maintainer" value={values.maintainer} onChange={(value) => updateValue("maintainer", value)} />
      <Button type="button" onClick={publishArtifact} disabled={publisher.isPublishing}>
        <PackagePlus className="mr-2 h-4 w-4" />
        Publish artifact
      </Button>
      {publisher.status && <p className="text-sm text-muted-foreground">{publisher.status}</p>}
      {(error || publisher.error) && <ErrorState title="Publish failed" error={error || publisher.error} />}
    </div>
  );
}

function PublishTextInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
