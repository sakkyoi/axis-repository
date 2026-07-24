import {
  PublishSessionDetailList,
  publishSessionArtifactSummary,
  type PublishSessionDetailComponentProps,
  type PublishSession,
} from "@axis-repository/admin-ui/plugin-ui";

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
