import type { PublishSession, PublishSessionStatus, Repository } from "./api/schemas";

export type PublishSessionStatusVariant = "default" | "success" | "warning" | "destructive";

export function sessionsForRepository(repositoryName: string, sessions: PublishSession[]): PublishSession[] {
  return sessions.filter((session) => session.repositoryName === repositoryName);
}

export function repositoryPublishSessionsView(
  repository: Pick<Repository, "name" | "ecosystem">,
  sessions: PublishSession[],
): {
  sessions: PublishSession[];
} {
  return {
    sessions: sessionsForRepository(repository.name, sessions),
  };
}

export function publishSessionStatusMeta(status: PublishSessionStatus): {
  label: string;
  variant: PublishSessionStatusVariant;
} {
  switch (status) {
    case "finalized":
      return { label: "finalized", variant: "success" };
    case "failed":
    case "aborted":
    case "expired":
      return { label: status, variant: "destructive" };
    case "pending_uploads":
      return { label: "pending uploads", variant: "warning" };
    case "ready":
    case "finalizing":
      return { label: status, variant: "default" };
  }
}

export function publishSessionArtifactSummary(session: PublishSession): string {
  const artifactLabel = session.artifacts.length === 1 ? "artifact" : "artifacts";
  return `${session.artifacts.length} ${artifactLabel}, ${session.verifiedUploads.length} verified`;
}
