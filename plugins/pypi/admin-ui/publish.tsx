import { useEffect, useState } from "react";
import { PackagePlus, X } from "lucide-react";
import {
  Button,
  useErrorToast,
  PublishSessionDetailList,
  publishSessionArtifactSummary,
  useRepositoryArtifactPublisher,
  type PublishSessionDetailComponentProps,
  type PublishSession,
  type Repository,
  type RepositoryPlugin,
} from "@axis-repository/admin-ui/plugin-ui";
import {
  buildPypiPublishArtifact,
  pypiCanPublishArtifact,
  readPypiPublishMetadata,
  type PypiPublishDistributionMetadata,
} from "./publish-model";

export function pypiPublishSessionArtifactSummary(session: PublishSession): string {
  const artifact = session.artifacts[0];
  if (!artifact || session.artifacts.length !== 1) return publishSessionArtifactSummary(session);
  return `${artifact.filename}, ${session.verifiedUploads.length} verified`;
}

export function PypiPublishSessionDetail({
  session,
}: PublishSessionDetailComponentProps) {
  return (
    <div className="mt-3 grid gap-3 text-xs">
      <PublishSessionDetailList
        title="Python distributions"
        items={session.artifacts.map((artifact) => artifact.filename)}
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

export function PypiPublishArtifactPreview({
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
  const [metadata, setMetadata] = useState<PypiPublishDistributionMetadata>();
  const [error, setError] = useState("");
  const canPublish = pypiCanPublishArtifact({
    file,
    metadata,
    error,
    isPublishing: publisher.isPublishing,
  });
  useErrorToast("Publish failed", error || publisher.error);

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
      setMetadata(await readPypiPublishMetadata(nextFile));
    } catch (metadataError) {
      setError(metadataError instanceof Error ? metadataError.message : String(metadataError));
    }
  }

  async function publishArtifact() {
    if (!file) {
      setError("Choose a wheel or source distribution before publishing.");
      return;
    }
    setError("");
    try {
      await publisher.publish({ files: [file], artifacts: [await buildPypiPublishArtifact(file)] });
      onPublished();
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : String(publishError));
    }
  }

  return (
    <div className="grid gap-4">
      {file ? (
        <div className="grid gap-1 rounded-md border border-border bg-background/40 p-3">
          <div className="text-xs font-medium uppercase text-muted-foreground">Selected distribution</div>
          <div className="break-words text-sm font-medium text-foreground">{file.name}</div>
          <div className="text-xs text-muted-foreground">{file.size.toLocaleString()} bytes</div>
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border bg-background/40 p-3 text-sm text-muted-foreground">
          Choose a .whl or .tar.gz from the toolbar or drop it on the repository browser.
        </div>
      )}
      {metadata && <PypiDistributionMetadataPreview metadata={metadata} />}
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
    </div>
  );
}

function PypiDistributionMetadataPreview({ metadata }: { metadata: PypiPublishDistributionMetadata }) {
  const rows = [
    ["Project", metadata.project],
    ["Version", metadata.version],
    ["Distribution", metadata.kind === "wheel" ? "Wheel" : "Source distribution"],
    ["Requires Python", metadata.requiresPython],
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
