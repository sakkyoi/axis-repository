import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAxisClient,
  useCreateAdminPublishSession,
  useFinalizeAdminPublishSession,
  useVerifyAdminPublishUpload,
} from "../../api/hooks";
import type { CreatedPublishSession, PublishArtifact, Repository } from "../../api/schemas";
import { publishSteps, type UploadProgress } from "./publish-progress-model";

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
  uploadArtifact(
    upload: CreatedPublishSession["uploads"][number],
    file: File,
    onProgress: (sent: { loaded: number; total?: number }) => void,
  ): Promise<void>;
  verifyUpload(input: { sessionId: string; uploadId: string }): Promise<unknown>;
  finalizeSession(sessionId: string): Promise<unknown>;
  refresh(): Promise<unknown>;
  onPhase(phase: RepositoryPublishPhase): void;
  onUploadProgress?(progress: UploadProgress): void;
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
    // Reported before the first byte as well as during, so a file that has not
    // started yet still shows which of several it is.
    input.onUploadProgress?.({ loaded: 0, total: file.size, fileNumber: index + 1, fileCount: input.files.length });
    await input.uploadArtifact(upload, file, (sent) => {
      input.onUploadProgress?.({
        loaded: sent.loaded,
        total: sent.total ?? file.size,
        fileNumber: index + 1,
        fileCount: input.files.length,
      });
    });
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
  // Where it got to, kept separately: a publish that throws goes back to idle,
  // and the phase alone can then no longer say which step stopped it.
  const [failedAt, setFailedAt] = useState<RepositoryPublishPhase>();
  const [upload, setUpload] = useState<UploadProgress>();
  const [error, setError] = useState("");
  const status = repositoryPublishStatusLabel(phase);
  const isPublishing =
    createSession.isPending ||
    verifyUpload.isPending ||
    finalizeSession.isPending ||
    phase === "uploading";

  async function publish(input: { files: File[]; artifacts: PublishArtifact[] }) {
    setError("");
    setFailedAt(undefined);
    setUpload(undefined);
    let reached: RepositoryPublishPhase = "preparing";
    try {
      await publishRepositoryArtifacts({
        repositoryName: repository.name,
        ecosystem: repository.ecosystem,
        files: input.files,
        artifacts: input.artifacts,
        createSession: (sessionInput) => createSession.mutateAsync(sessionInput),
        uploadArtifact: (target, file, onProgress) => client.uploadPublishArtifact(target, file, onProgress),
        verifyUpload: (verifyInput) => verifyUpload.mutateAsync(verifyInput),
        finalizeSession: (sessionId) => finalizeSession.mutateAsync(sessionId),
        refresh: async () => {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["publish-sessions"] }),
            queryClient.invalidateQueries({ queryKey: ["repository-objects", repository.name] }),
          ]);
        },
        onPhase: (next) => {
          reached = next;
          setPhase(next);
        },
        onUploadProgress: setUpload,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setFailedAt(reached);
      setPhase("idle");
    }
  }

  return {
    publish,
    status,
    phase,
    steps: publishSteps({ phase, ...(failedAt === undefined ? {} : { failedAt }) }),
    upload,
    /** True once a publish has begun, whether it is still running or not. */
    hasStarted: phase !== "idle" || failedAt !== undefined,
    error,
    isPublishing,
  };
}
