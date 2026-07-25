import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAxisClient,
  useCreateAdminPublishSession,
  useFinalizeAdminPublishSession,
  useVerifyAdminPublishUpload,
} from "../../api/hooks";
import type { PublishArtifact, PublishSession, Repository } from "../../api/schemas";

export interface RepositoryPublishFlowInput {
  repositoryName: string;
  ecosystem: string;
  files: File[];
  artifacts: PublishArtifact[];
  createSession(input: {
    repositoryName: string;
    ecosystem: string;
    artifacts: PublishArtifact[];
  }): Promise<PublishSession>;
  uploadArtifact(upload: PublishSession["uploads"][number], file: File): Promise<void>;
  verifyUpload(input: { sessionId: string; uploadId: string }): Promise<unknown>;
  finalizeSession(sessionId: string): Promise<unknown>;
  refresh(): Promise<unknown>;
  onStatus(status: string): void;
}

export async function publishRepositoryArtifacts(input: RepositoryPublishFlowInput): Promise<void> {
  input.onStatus("Preparing artifacts...");
  const session = await input.createSession({
    repositoryName: input.repositoryName,
    ecosystem: input.ecosystem,
    artifacts: input.artifacts,
  });
  if (session.uploads.length < input.files.length) {
    throw new Error("Publish session did not return enough upload targets.");
  }

  input.onStatus("Uploading artifacts...");
  for (const [index, file] of input.files.entries()) {
    const upload = session.uploads[index];
    if (!upload) throw new Error("Publish session did not return enough upload targets.");
    await input.uploadArtifact(upload, file);
  }

  input.onStatus("Verifying uploads...");
  for (const upload of session.uploads.slice(0, input.files.length)) {
    await input.verifyUpload({ sessionId: session.id, uploadId: upload.uploadId });
  }

  input.onStatus("Finalizing repository...");
  await input.finalizeSession(session.id);
  await input.refresh();
  input.onStatus("Published.");
}

export function useRepositoryArtifactPublisher(repository: Repository) {
  const client = useAxisClient();
  const queryClient = useQueryClient();
  const createSession = useCreateAdminPublishSession();
  const verifyUpload = useVerifyAdminPublishUpload();
  const finalizeSession = useFinalizeAdminPublishSession();
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const isPublishing =
    createSession.isPending ||
    verifyUpload.isPending ||
    finalizeSession.isPending ||
    status === "Uploading artifacts...";

  async function publish(input: { files: File[]; artifacts: PublishArtifact[] }) {
    setError("");
    try {
      await publishRepositoryArtifacts({
        repositoryName: repository.name,
        ecosystem: repository.ecosystem,
        files: input.files,
        artifacts: input.artifacts,
        createSession: (sessionInput) => createSession.mutateAsync(sessionInput),
        uploadArtifact: (upload, file) => client.uploadPublishArtifact(upload, file),
        verifyUpload: (verifyInput) => verifyUpload.mutateAsync(verifyInput),
        finalizeSession: (sessionId) => finalizeSession.mutateAsync(sessionId),
        refresh: async () => {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["publish-sessions"] }),
            queryClient.invalidateQueries({ queryKey: ["repository-objects", repository.name] }),
          ]);
        },
        onStatus: setStatus,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setStatus("");
    }
  }

  return {
    publish,
    status,
    error,
    isPublishing,
  };
}
