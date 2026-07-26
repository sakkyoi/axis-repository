import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAxisClient,
  useCreateAdminPublishSession,
  useFinalizeAdminPublishSession,
  useVerifyAdminPublishUpload,
} from "../../api/hooks";
import type { CreatedPublishSession, PublishArtifact, Repository } from "../../api/schemas";

export interface RepositoryPublishFlowInput {
  repositoryName: string;
  ecosystem: string;
  files: File[];
  artifacts: PublishArtifact[];
  createSession(input: {
    repositoryName: string;
    ecosystem: string;
    artifacts: PublishArtifact[];
  }): Promise<CreatedPublishSession>;
  uploadArtifact(upload: CreatedPublishSession["uploads"][number], file: File): Promise<void>;
  verifyUpload(input: { sessionId: string; uploadId: string }): Promise<unknown>;
  finalizeSession(sessionId: string): Promise<unknown>;
  refresh(): Promise<unknown>;
  onPhase(phase: RepositoryPublishPhase): void;
}

/**
 * Phases the publish flow moves through. Kept separate from the labels so busy
 * state does not depend on display copy.
 */
export type RepositoryPublishPhase =
  | "idle"
  | "preparing"
  | "uploading"
  | "verifying"
  | "finalizing"
  | "published";

const repositoryPublishPhaseLabels: Record<RepositoryPublishPhase, string> = {
  idle: "",
  preparing: "Preparing artifacts...",
  uploading: "Uploading artifacts...",
  verifying: "Verifying uploads...",
  finalizing: "Finalizing repository...",
  published: "Published.",
};

export function repositoryPublishStatusLabel(phase: RepositoryPublishPhase): string {
  return repositoryPublishPhaseLabels[phase];
}

export async function publishRepositoryArtifacts(input: RepositoryPublishFlowInput): Promise<void> {
  input.onPhase("preparing");
  const session = await input.createSession({
    repositoryName: input.repositoryName,
    ecosystem: input.ecosystem,
    artifacts: input.artifacts,
  });
  if (session.uploads.length < input.files.length) {
    throw new Error("Publish session did not return enough upload targets.");
  }

  input.onPhase("uploading");
  for (const [index, file] of input.files.entries()) {
    const upload = session.uploads[index];
    if (!upload) throw new Error("Publish session did not return enough upload targets.");
    await input.uploadArtifact(upload, file);
  }

  input.onPhase("verifying");
  for (const upload of session.uploads.slice(0, input.files.length)) {
    await input.verifyUpload({ sessionId: session.id, uploadId: upload.uploadId });
  }

  input.onPhase("finalizing");
  await input.finalizeSession(session.id);
  await input.refresh();
  input.onPhase("published");
}

export function useRepositoryArtifactPublisher(repository: Repository) {
  const client = useAxisClient();
  const queryClient = useQueryClient();
  const createSession = useCreateAdminPublishSession();
  const verifyUpload = useVerifyAdminPublishUpload();
  const finalizeSession = useFinalizeAdminPublishSession();
  const [phase, setPhase] = useState<RepositoryPublishPhase>("idle");
  const [error, setError] = useState("");
  const status = repositoryPublishStatusLabel(phase);
  const isPublishing =
    createSession.isPending ||
    verifyUpload.isPending ||
    finalizeSession.isPending ||
    phase === "uploading";

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
        onPhase: setPhase,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setPhase("idle");
    }
  }

  return {
    publish,
    status,
    error,
    isPublishing,
  };
}
