import { useEffect, useState } from "react";
import { PackagePlus, X } from "lucide-react";
import {
  Button,
  ErrorState,
  PublishSessionDetailList,
  useRepositoryArtifactPublisher,
  type PublishSessionDetailComponentProps,
  type Repository,
  type RepositoryPlugin,
} from "@axis-repository/admin-ui/plugin-ui";
import {
  aptCanPublishArtifact,
  buildAptPublishArtifact,
  readAptPublishPackageMetadata,
  type AptPublishPackageMetadata,
} from "./publish-model";

export function AptPublishArtifactPreview({
  repository,
  droppedFiles,
  onCancel,
  onPublished,
}: {
  repository: Repository;
  pluginMetadata: RepositoryPlugin | undefined;
  droppedFiles: File[];
  onCancel: () => void;
  onPublished: () => void;
}) {
  const publisher = useRepositoryArtifactPublisher(repository);
  const [file, setFile] = useState<File>();
  const [metadata, setMetadata] = useState<AptPublishPackageMetadata>();
  const [error, setError] = useState("");
  const canPublish = aptCanPublishArtifact({
    file,
    metadata,
    error,
    isPublishing: publisher.isPublishing,
  });

  useEffect(() => {
    const droppedFile = droppedFiles[0];
    if (droppedFile) {
      void onFileSelected(droppedFile);
    }
  }, [droppedFiles]);

  async function onFileSelected(nextFile: File | undefined) {
    setFile(nextFile);
    setMetadata(undefined);
    setError("");
    if (!nextFile) {
      return;
    }
    try {
      setMetadata(await readAptPublishPackageMetadata(nextFile));
    } catch (metadataError) {
      setError(metadataError instanceof Error ? metadataError.message : String(metadataError));
    }
  }

  async function publishArtifact() {
    if (!file) {
      setError("Choose a .deb file before publishing.");
      return;
    }
    setError("");
    try {
      const artifact = await buildAptPublishArtifact(file);
      await publisher.publish({ files: [file], artifacts: [artifact] });
      onPublished();
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : String(publishError));
    }
  }

  return (
    <div className="grid gap-4">
      {file ? (
        <div className="grid gap-1 rounded-md border border-border bg-background/40 p-3">
          <div className="text-xs font-medium uppercase text-muted-foreground">Selected artifact</div>
          <div className="break-words text-sm font-medium text-foreground">{file.name}</div>
          <div className="text-xs text-muted-foreground">{file.size.toLocaleString()} bytes</div>
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border bg-background/40 p-3 text-sm text-muted-foreground">
          Choose a .deb file from the toolbar or drop it on the repository browser.
        </div>
      )}
      {metadata && <AptPackageMetadataPreview metadata={metadata} />}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={publisher.isPublishing}>
          <X className="mr-2 h-4 w-4" />
          Cancel
        </Button>
        <Button type="button" onClick={publishArtifact} disabled={!canPublish}>
          <PackagePlus className="mr-2 h-4 w-4" />
          Publish
        </Button>
      </div>
      {publisher.status && <p className="text-sm text-muted-foreground">{publisher.status}</p>}
      {(error || publisher.error) && <ErrorState title="Publish failed" error={error || publisher.error} />}
    </div>
  );
}

function AptPackageMetadataPreview({ metadata }: { metadata: AptPublishPackageMetadata }) {
  const rows = [
    ["Package", metadata.packageName],
    ["Version", metadata.version],
    ["Architecture", metadata.architecture],
    ["Maintainer", metadata.maintainer],
    ["Description", metadata.description],
    ["Section", metadata.section],
    ["Priority", metadata.priority],
    ["Depends", metadata.depends],
  ].filter(([, value]) => value);

  return (
    <dl className="grid gap-2 rounded-md border border-border bg-panel/60 p-3 text-xs sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="grid gap-0.5">
          <dt className="font-medium text-muted-foreground">{label}</dt>
          <dd className="break-words text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function AptPublishSessionDetail({
  session,
}: PublishSessionDetailComponentProps) {
  return (
    <div className="mt-3 grid gap-3 text-xs">
      <PublishSessionDetailList
        title="APT artifacts"
        items={session.artifacts.map((artifact) => {
          const metadata = artifact.metadata;
          const packageName = typeof metadata.package === "string" ? metadata.package : artifact.filename;
          const version = typeof metadata.version === "string" ? metadata.version : "-";
          const architecture = typeof metadata.architecture === "string" ? metadata.architecture : "-";
          return `${packageName} ${version} ${architecture} · ${artifact.filename}`;
        })}
      />
      <PublishSessionDetailList title="Uploads" items={session.uploads.map((upload) => `${upload.uploadId} · ${upload.filename}`)} />
      <PublishSessionDetailList
        title="Verified uploads"
        items={session.verifiedUploads.map((upload) => `${upload.uploadId} · ${upload.size} bytes`)}
      />
      {session.publishResult && (
        <PublishSessionDetailList title="Published repository objects" items={session.publishResult.objects.map((object) => object.key)} />
      )}
      {session.failure && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-destructive">
          {session.failure.message}
        </div>
      )}
    </div>
  );
}
