import { useState } from "react";
import { PackagePlus } from "lucide-react";
import {
  Button,
  ErrorState,
  Input,
  PublishSessionDetailList,
  useRepositoryArtifactPublisher,
  type PublishSessionDetailComponentProps,
  type Repository,
} from "@axis-repository/admin-ui/plugin-ui";
import {
  buildAptPublishArtifact,
  readAptPublishPackageMetadata,
  type AptPublishPackageMetadata,
} from "./publish-model";

export function AptPublishArtifactForm({ repository }: { repository: Repository }) {
  const publisher = useRepositoryArtifactPublisher(repository);
  const [file, setFile] = useState<File>();
  const [metadata, setMetadata] = useState<AptPublishPackageMetadata>();
  const [error, setError] = useState("");

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
        onChange={(event) => void onFileSelected(event.currentTarget.files?.[0])}
      />
      {metadata && <AptPackageMetadataPreview metadata={metadata} />}
      <Button type="button" onClick={publishArtifact} disabled={publisher.isPublishing}>
        <PackagePlus className="mr-2 h-4 w-4" />
        Publish artifact
      </Button>
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
